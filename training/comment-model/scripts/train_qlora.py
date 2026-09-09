import argparse
import hashlib
import json
import os
import platform
import random
from pathlib import Path

import torch
from datasets import Dataset
from peft import LoraConfig, prepare_model_for_kbit_training
from safetensors.torch import load_file
from transformers import (
    AutoModelForImageTextToText,
    AutoProcessor,
    BitsAndBytesConfig,
    DataCollatorForSeq2Seq,
    Trainer,
    TrainingArguments,
    set_seed,
)


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def read_jsonl(path):
    return [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def tokenize_row(row, processor, max_length):
    messages = row["messages"]
    prefix = messages[:-1]
    full_text = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=False)
    prefix_text = processor.apply_chat_template(prefix, tokenize=False, add_generation_prompt=True)
    full = processor.tokenizer(full_text, truncation=True, max_length=max_length)
    prefix_ids = processor.tokenizer(prefix_text, truncation=True, max_length=max_length)["input_ids"]
    labels = list(full["input_ids"])
    prefix_length = min(len(prefix_ids), len(labels))
    labels[:prefix_length] = [-100] * prefix_length
    full["labels"] = labels
    return full


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--download-only", action="store_true")
    args = parser.parse_args()
    config = read_json(args.config)
    data_path = Path(config["dataset"])
    output_dir = Path(config["output_dir"])
    output_dir.mkdir(parents=True, exist_ok=True)
    set_seed(config["seed"])

    rows = read_jsonl(data_path)
    if not rows:
        raise RuntimeError("Dataset is empty.")
    if not config.get("smoke_only") and any(row.get("meta", {}).get("approvedForProductionSft") is not True for row in rows):
        raise RuntimeError("Production SFT requires every record to be explicitly approved.")

    quantization = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16,
        bnb_4bit_use_double_quant=True,
    )
    processor = AutoProcessor.from_pretrained(config["model_id"], revision=config["revision"])
    model = AutoModelForImageTextToText.from_pretrained(
        config["model_id"],
        revision=config["revision"],
        quantization_config=quantization,
        torch_dtype=torch.bfloat16,
        device_map="auto",
    )
    if args.download_only:
        print("Model and processor download completed.")
        return

    model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True)
    model.config.use_cache = False
    peft_config = LoraConfig(
        r=config["lora_rank"],
        lora_alpha=config["lora_alpha"],
        lora_dropout=config["lora_dropout"],
        bias="none",
        task_type="CAUSAL_LM",
        # Restrict adapters to the text language tower. Vision/audio projections
        # use Gemma4ClippableLinear wrappers and receive no gradient for text-only
        # examples.
        target_modules=r".*language_model.*\.(q_proj|k_proj|v_proj|o_proj|gate_proj|up_proj|down_proj)",
    )

    dataset = Dataset.from_list(rows).map(
        lambda row: tokenize_row(row, processor, config["max_length"]),
        remove_columns=list(rows[0].keys()),
    )
    training_args = TrainingArguments(
        output_dir=str(output_dir),
        per_device_train_batch_size=config["batch_size"],
        gradient_accumulation_steps=config["gradient_accumulation_steps"],
        learning_rate=config["learning_rate"],
        num_train_epochs=config["epochs"],
        max_steps=config.get("max_steps", -1),
        bf16=True,
        gradient_checkpointing=True,
        logging_steps=1,
        save_strategy="no",
        report_to="none",
        remove_unused_columns=False,
        seed=config["seed"],
    )
    from peft import get_peft_model
    model = get_peft_model(model, peft_config)
    model.print_trainable_parameters()
    data_collator = DataCollatorForSeq2Seq(
        tokenizer=processor.tokenizer,
        model=None,
        padding=True,
        label_pad_token_id=-100,
        pad_to_multiple_of=8,
    )
    trainer = Trainer(model=model, args=training_args, train_dataset=dataset, data_collator=data_collator)
    result = trainer.train()
    model.save_pretrained(output_dir / "adapter")
    processor.save_pretrained(output_dir / "adapter")
    adapter_path = output_dir / "adapter" / "adapter_model.safetensors"
    adapter_state = load_file(str(adapter_path))
    lora_b = [value for key, value in adapter_state.items() if "lora_B" in key]
    updated_lora_b_tensors = sum(torch.count_nonzero(value).item() > 0 for value in lora_b)
    if not lora_b or updated_lora_b_tensors != len(lora_b):
        raise RuntimeError(
            f"LoRA update verification failed: {updated_lora_b_tensors}/{len(lora_b)} B tensors changed."
        )
    manifest = {
        "modelId": config["model_id"],
        "modelRevision": config["revision"],
        "dataset": str(data_path),
        "datasetSha256": sha256(data_path),
        "records": len(rows),
        "config": config,
        "metrics": result.metrics,
        "adapterVerification": {
            "loraBTensors": len(lora_b),
            "updatedLoraBTensors": updated_lora_b_tensors,
            "languageTowerOnly": all("language_model" in key for key in adapter_state),
        },
        "torch": torch.__version__,
        "cuda": torch.version.cuda,
        "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        "python": platform.python_version(),
        "productionReady": False,
    }
    (output_dir / "run-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
