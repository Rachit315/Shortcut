"""Real end-to-end test of the Clazy desktop binary on Linux/X11.

Starts the actual app under Xvfb, then drives it like a user with xdotool:
global hotkeys, text triggers, {{cursor}}, {{clipboard}}, clipboard restore,
the quick palette (search + fill-in form) and usage stats — and checks what
actually lands in *another* application's text box.

Usage (see e2e/run.sh):  python3 e2e/run_e2e.py <path-to-clazy-binary>
Requires: Xvfb, xdotool, xclip, python3 with tkinter.
"""
import datetime
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import uuid

BINARY = os.path.abspath(sys.argv[1])
HERE = os.path.dirname(os.path.abspath(__file__))
DISPLAY = os.environ.get("E2E_DISPLAY", ":99")
ARTIFACTS = os.environ.get("E2E_ARTIFACTS")

work = tempfile.mkdtemp(prefix="clazy-e2e-")
data_dir = os.path.join(work, "data")
target_dir = os.path.join(work, "target")
os.makedirs(data_dir)
os.makedirs(target_dir)

env = dict(os.environ)
env.update(
    DISPLAY=DISPLAY,
    CLAZY_DATA_DIR=data_dir,
    CLAZY_START_HIDDEN="1",
    WEBKIT_DISABLE_COMPOSITING_MODE="1",
    WEBKIT_DISABLE_DMABUF_RENDERER="1",
    NO_AT_BRIDGE="1",
    XDG_SESSION_TYPE="x11",
)
env.pop("WAYLAND_DISPLAY", None)

procs = []
results = []


def spawn(args, **kw):
    p = subprocess.Popen(args, env=env, stdout=kw.pop("stdout", subprocess.DEVNULL), stderr=kw.pop("stderr", subprocess.STDOUT), **kw)
    procs.append(p)
    return p


def sh(*args, check=True, input=None):
    return subprocess.run(args, env=env, check=check, capture_output=True, text=True, input=input).stdout.strip()


def wait_for(fn, timeout=6.0, interval=0.05):
    end = time.time() + timeout
    last = None
    while time.time() < end:
        last = fn()
        if last:
            return last
        time.sleep(interval)
    return last


def content():
    try:
        with open(os.path.join(target_dir, "content.txt"), encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return ""


def clear_target():
    open(os.path.join(target_dir, "clear"), "w").close()
    assert wait_for(lambda: content() == "" and not os.path.exists(os.path.join(target_dir, "clear")), 3), "target did not clear"


def set_clipboard(text):
    subprocess.run(["xclip", "-selection", "clipboard", "-i"], env=env, input=text, text=True, check=True)
    assert wait_for(lambda: get_clipboard() == text, 2), "clipboard not set"


def get_clipboard():
    r = subprocess.run(["xclip", "-selection", "clipboard", "-o"], env=env, capture_output=True, text=True, timeout=3)
    return r.stdout if r.returncode == 0 else None


def focus_target():
    wid = sh("xdotool", "search", "--name", "^E2E Target$").splitlines()[0]
    sh("xdotool", "mousemove", "--window", wid, "200", "150", "click", "1")
    sh("xdotool", "windowfocus", "--sync", wid)
    time.sleep(0.2)
    return wid


def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(("PASS " if cond else "FAIL ") + name + (f" — {detail}" if detail and not cond else ""), flush=True)


def screenshot(name):
    if ARTIFACTS and shutil.which("import"):
        os.makedirs(ARTIFACTS, exist_ok=True)
        subprocess.run(["import", "-window", "root", os.path.join(ARTIFACTS, f"{name}.png")], env=env)


def db():
    return sqlite3.connect(os.path.join(data_dir, "clazy.db"))


try:
    xvfb = spawn(["Xvfb", DISPLAY, "-screen", "0", "1600x1000x24", "-nolisten", "tcp"])
    time.sleep(1.0)

    # ---- 1. First launch: creates the database and seeds the starter pack.
    app = spawn([BINARY], stdout=open(os.path.join(work, "app1.log"), "w"))
    assert wait_for(lambda: os.path.exists(os.path.join(data_dir, "clazy.db")), 20), "database not created"
    time.sleep(3)
    check("app starts and stays running", app.poll() is None, f"exit={app.poll()}")
    with db() as c:
        titles = [r[0] for r in c.execute("SELECT title FROM prompts ORDER BY title")]
    check("starter pack seeded", len(titles) == 5 and "Commit & push" in titles, str(titles))
    check("first run shows the main window", wait_for(lambda: sh("xdotool", "search", "--onlyvisible", "--name", "^Clazy$", check=False), 5), "main window not visible")
    screenshot("01-first-run")
    app.terminate()
    app.wait(10)

    # ---- 2. Configure test prompts directly in the app's own database.
    now = int(time.time() * 1000)
    with db() as c:
        c.execute("INSERT OR REPLACE INTO kv (key, value) VALUES ('settings', ?)", (json.dumps({"onboarding_complete": True}),))
        rows = [
            ("Hello prompt", "Hello from Clazy {{date}}", "Ctrl+Alt+9", ";e2e"),
            ("Cursor test", "AB{{cursor}}CD", None, ";cur"),
            ("Fix clipboard", "Fix this: {{clipboard}}", "Ctrl+Alt+8", None),
            ("Greeting", "Hi {{name}}, welcome!", None, ";hi"),
            ("Multiline", "line one\nline two", "Ctrl+Alt+7", None),
        ]
        for title, body, hotkey, trigger in rows:
            c.execute(
                'INSERT INTO prompts (id, title, body, tags, favorite, hotkey, "trigger", created_at, updated_at) VALUES (?, ?, ?, \'[]\', 0, ?, ?, ?, ?)',
                (str(uuid.uuid4()), title, body, hotkey, trigger, now, now),
            )

    # ---- 3. The "other app" and a hidden (tray) launch, as after login.
    spawn(["python3.12" if shutil.which("python3.12") else "python3", os.path.join(HERE, "target_app.py"), target_dir])
    assert wait_for(lambda: sh("xdotool", "search", "--name", "^E2E Target$", check=False), 10), "target window missing"
    wrap = ["gdb", "-q", "-batch", "-ex", "run", "-ex", "thread apply all bt 25", "--args"] if os.environ.get("E2E_GDB") else []
    app = spawn(wrap + [BINARY, "--minimized"], stdout=open(os.path.join(work, "app2.log"), "w"))
    time.sleep(4)
    check("relaunch in background", app.poll() is None, f"exit={app.poll()}")
    check("no window shown when onboarded + --minimized", not sh("xdotool", "search", "--onlyvisible", "--name", "^Clazy$", check=False))
    today = datetime.date.today().isoformat()

    # ---- 4. Global hotkey pastes into the focused app and restores the clipboard.
    focus_target()
    clear_target()
    set_clipboard("ORIGINAL-CLIPBOARD")
    sh("xdotool", "key", "--clearmodifiers", "ctrl+alt+9")
    got = wait_for(lambda: content() == f"Hello from Clazy {today}" and content(), 5)
    check("hotkey pastes rendered prompt", got == f"Hello from Clazy {today}", repr(content()))
    restored = wait_for(lambda: get_clipboard() == "ORIGINAL-CLIPBOARD", 3)
    check("clipboard restored after paste", restored, repr(get_clipboard()))

    # ---- 5. Text trigger expands in place.
    focus_target()
    clear_target()
    sh("xdotool", "type", "--delay", "40", "note: ;e2e")
    got = wait_for(lambda: content() == f"note: Hello from Clazy {today}", 5)
    check("text trigger expands and erases the trigger", got, repr(content()))

    # ---- 6. {{cursor}} places the caret.
    focus_target()
    clear_target()
    sh("xdotool", "type", "--delay", "40", ";cur")
    wait_for(lambda: content() == "ABCD", 5)
    time.sleep(0.5)
    sh("xdotool", "type", "X")
    got = wait_for(lambda: content() == "ABXCD", 3)
    check("{{cursor}} moves the caret", got, repr(content()))

    # ---- 7. {{clipboard}} inserts what was copied.
    focus_target()
    clear_target()
    set_clipboard("bug-123 in parser.rs")
    sh("xdotool", "key", "--clearmodifiers", "ctrl+alt+8")
    got = wait_for(lambda: content() == "Fix this: bug-123 in parser.rs", 5)
    check("{{clipboard}} is substituted", got, repr(content()))

    # ---- 8. Multi-line prompt arrives intact.
    focus_target()
    clear_target()
    sh("xdotool", "key", "--clearmodifiers", "ctrl+alt+7")
    got = wait_for(lambda: content() == "line one\nline two", 5)
    check("multi-line prompt pasted intact", got, repr(content()))

    # ---- 9. Quick palette: search, Enter, focus returns to the previous app.
    focus_target()
    clear_target()
    sh("xdotool", "key", "--clearmodifiers", "ctrl+shift+space")
    visible = wait_for(lambda: sh("xdotool", "search", "--onlyvisible", "--name", "Quick palette", check=False), 5)
    check("palette hotkey opens the palette", visible)
    time.sleep(1.0)
    screenshot("02-palette")
    sh("xdotool", "type", "--delay", "40", "hello prompt")
    time.sleep(0.4)
    screenshot("02b-palette-typed")
    sh("xdotool", "key", "Return")
    got = wait_for(lambda: content() == f"Hello from Clazy {today}", 6)
    check("palette pastes into the previous app", got, repr(content()))
    screenshot("02c-after-enter")
    check("palette hides after pasting", not sh("xdotool", "search", "--onlyvisible", "--name", "Quick palette", check=False))

    # ---- 10. Fill-in variables via trigger → form → paste.
    focus_target()
    clear_target()
    sh("xdotool", "type", "--delay", "40", ";hi")
    visible = wait_for(lambda: sh("xdotool", "search", "--onlyvisible", "--name", "Quick palette", check=False), 5)
    check("trigger with fill-ins opens the form", visible)
    check("trigger text erased before asking", wait_for(lambda: content() == "", 3), repr(content()))
    time.sleep(1.0)
    screenshot("03-fill-form")
    sh("xdotool", "type", "--delay", "40", "Ada")
    sh("xdotool", "key", "Return")
    got = wait_for(lambda: content() == "Hi Ada, welcome!", 6)
    check("fill-in value pasted", got, repr(content()))

    # ---- 11. Usage stats and remembered values were recorded.
    time.sleep(0.5)
    with db() as c:
        counts = dict(c.execute("SELECT title, use_count FROM prompts"))
        remembered = c.execute("SELECT value FROM variable_values WHERE name = 'name'").fetchone()
    check("usage counters updated", counts.get("Hello prompt") == 3 and counts.get("Greeting") == 1, str(counts))
    check("fill-in value remembered", remembered and remembered[0] == "Ada", str(remembered))
    check("app still running at the end", app.poll() is None, f"exit={app.poll()}")

finally:
    for p in reversed(procs):
        if p.poll() is None:
            p.terminate()
            try:
                p.wait(5)
            except subprocess.TimeoutExpired:
                p.kill()
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
    if failed:
        for log in ("app1.log", "app2.log"):
            path = os.path.join(work, log)
            if os.path.exists(path):
                print(f"--- {log} ---\n" + open(path).read()[-3000:])
    shutil.rmtree(work, ignore_errors=True)

sys.exit(1 if failed or not results else 0)
