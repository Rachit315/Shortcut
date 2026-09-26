"""A stand-in for "any other app": a Tk text box that mirrors its content to a file.

Usage: python3 target_app.py <state-dir>
  <state-dir>/content.txt  — current text (rewritten every 50 ms)
  <state-dir>/clear        — create this file to clear the text box
"""
import os
import sys
import tkinter as tk

state = sys.argv[1]
root = tk.Tk()
root.title("E2E Target")
root.geometry("900x400+40+40")
text = tk.Text(root, font=("DejaVu Sans Mono", 12), undo=False)
text.pack(fill="both", expand=True)
text.focus_set()
last = None


def tick():
    global last
    clear = os.path.join(state, "clear")
    if os.path.exists(clear):
        text.delete("1.0", "end")
        os.remove(clear)
    value = text.get("1.0", "end-1c")
    if value != last:
        tmp = os.path.join(state, "content.tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(value)
        os.replace(tmp, os.path.join(state, "content.txt"))
        last = value
    root.after(50, tick)


tick()
root.mainloop()
