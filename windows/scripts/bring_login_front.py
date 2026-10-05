import win32gui, win32con, win32service, sys, time, ctypes

user32 = ctypes.windll.user32
h_desk = user32.OpenDesktopW('Default', 0, False, 0x01FF)
if h_desk:
    user32.SetThreadDesktop(h_desk)

watch_seconds = 1
if len(sys.argv) > 1 and sys.argv[1].isdigit():
    watch_seconds = int(sys.argv[1])

found = False
start_time = time.time()

def cb(hwnd, _):
    global found
    if win32gui.IsWindowVisible(hwnd):
        title = win32gui.GetWindowText(hwnd)
        if any(k in title for k in ['네이버 : 로그인', 'NAVER', '로그인', 'nidlogin', '새 탭 - Chrome']):
            rect = win32gui.GetWindowRect(hwnd)
            if rect[2] - rect[0] > 100:
                print(f'Bringing window to front: "{title}"')
                win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
                win32gui.SetWindowPos(hwnd, win32con.HWND_TOPMOST, 200, 80, 1150, 880, win32con.SWP_SHOWWINDOW)
                win32gui.SetWindowPos(hwnd, win32con.HWND_NOTOPMOST, 200, 80, 1150, 880, win32con.SWP_SHOWWINDOW)
                win32gui.SetForegroundWindow(hwnd)
                found = True

while time.time() - start_time < watch_seconds:
    found = False
    if h_desk:
        win32gui.EnumDesktopWindows(h_desk, cb, None)
    else:
        win32gui.EnumWindows(cb, None)
    if found and watch_seconds == 1:
        break
    time.sleep(1)
