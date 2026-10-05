"""Exercise the installed entry point on a real POSIX pseudo-terminal."""
import errno
import fcntl
import json
import os
import pty
import select
import signal
import struct
import sys
import tempfile
import termios
import time


def run_case(mode):
    with tempfile.TemporaryDirectory(prefix="senv-tui-pty-") as directory:
        if mode.startswith("shell-") or mode in ("account", "navigation"):
            api_url, credential = sys.argv[4:6]
            config = {"active": "test", "profiles": {"test": {"apiUrl": api_url, "accountId": "user", "credentialStore": "file"}}, "credentials": {f"{api_url}|test|user": credential}}
            with open(os.path.join(directory, "config.json"), "w") as file:
                json.dump(config, file)
            os.chmod(os.path.join(directory, "config.json"), 0o600)
        master, slave = pty.openpty()
        before = termios.tcgetattr(slave)
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 100, 0, 0))
        pid = os.fork()
        if pid == 0:
            # Keep a separate, non-orphaned job-control group in the parent's session.
            os.setpgid(0, 0)
            for descriptor in (0, 1, 2):
                os.dup2(slave, descriptor)
            os.close(master)
            environment = dict(os.environ)
            for key in ("SENV_TOKEN", "SENV_INSTANCE", "SENV_PROJECT", "CI"):
                environment.pop(key, None)
            environment.update(SENV_CONFIG_DIR=directory, TERM="xterm-256color", NO_COLOR="1")
            if mode == "ascii":
                environment.update(SENV_ASCII="1", LC_ALL="C")
            os.chdir(directory)
            os.execve(sys.argv[1], [sys.argv[1], sys.argv[2], "tui", *(["--project", "project"] if mode.startswith("shell-") or mode == "navigation" else [])], environment)
        output = bytearray()

        def read_until(pattern, timeout=8):
            deadline = time.monotonic() + timeout
            while pattern not in output and time.monotonic() < deadline:
                if select.select([master], [], [], 0.1)[0]:
                    try:
                        output.extend(os.read(master, 65536))
                    except OSError as error:
                        if error.errno != errno.EIO:
                            raise
                        break
            assert pattern in output, (pattern, bytes(output)[-4000:])

        try:
            if mode.startswith("shell-"):
                read_until(b"deployment  static  healthy")
                entered = b"\x1b[?1049h" in output
                os.write(master, b"a")
                read_until(b"Publish deployment")
                os.write(master, b"\x1b[B" * 10)
                read_until(b"> Open origin shell")
                output.clear()
                os.write(master, b"\r")
                read_until(b"Absolute shell path")
                os.write(master, b"\r")
                read_until(b"Review")
                output.clear()
                os.write(master, b"\r")
                read_until(b"SENV_SHELL_READY")
                assert b"\x1b[?1049l" in output
                assert not termios.tcgetattr(slave)[3] & termios.ICANON
                output.clear()
                if mode == "shell-exit":
                    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 28, 110, 0, 0))
                    os.kill(pid, signal.SIGWINCH)
                    time.sleep(0.1)
                    os.write(master, b"stty size; sleep 30\n")
                    read_until(b"28 110")
                    os.write(master, b"\x03")
                    time.sleep(0.1)
                    os.write(master, b"printf 'SENV_INTERRUPT_OK\\n'; exit 7\n")
                    read_until(b"Remote exit code: 7")
                    assert b"SENV_INTERRUPT_OK" in output
                elif mode == "shell-detach":
                    os.write(master, b"\x1d")
                    read_until(b"Detached locally.")
                else:
                    os.write(master, b"disconnect\n")
                    read_until(b"Terminal connection ended without an exit status.")
                read_until(b"a actions")
                assert b"\x1b[?1049h" in output
                assert not termios.tcgetattr(slave)[3] & termios.ICANON
                output.clear()
                if mode != "shell-disconnect":
                    os.write(master, b"\r")
                    read_until(b"Deployments")
                os.write(master, b"q")
            elif mode == "navigation":
                read_until(b"deployment  static  healthy")
                entered = b"\x1b[?1049h" in output

                def press(keys, expected):
                    output.clear()
                    os.write(master, keys)
                    read_until(expected)

                press(b"l", b"tag-assigned")
                press(b"h", b"deployment  static  healthy")
                press(b"\r", b"[ HEALTHY ]")
                press(b"\x1b[C", b"FIXED ADDRESS")
                press(b"l", b"Log output 49")
                read_until(b"36-51/51")
                press(b"k", b"35-50/51")
                press(b"j", b"36-51/51")
                press(b"gg", b"SENV_PREVIEW_READY")
                read_until(b"1-16/51")
                assert b'"msg"' not in output
                press(b"G", b"36-51/51")
                for _ in range(8):
                    os.write(master, b"j")
                    time.sleep(0.03)
                press(b"k", b"35-50/51")
                press(b"G", b"36-51/51")
                press(b"jjjjjjjjk", b"35-50/51")
                press(b"l", b"256.0 MiB")
                press(b"G", b"peak 26.4%")
                read_until(b"128.0 MiB")
                press(b"l", b"Dafni 0")
                press(b"G", b"Dafni 9")
                read_until(b"24-39/39")
                for _ in range(8):
                    os.write(master, b"j")
                    time.sleep(0.03)
                press(b"k", b"23-38/39")
                press(b"gg", b"Dafni 0")
                read_until(b"1-16/39")
                press(b"\x1b", b"deployment  static  healthy")
                press(b"\x1b", b"Projects | 1 project")
                press(b"\r", b"deployment  static  healthy")
                press(b"\t", b"> Projects")
                press(b"\x1b[B", b"> Account")
                press(b"\r", b"[Profile]")
                press(b"\x1b[C", b"CLI test session")
                output.clear()
                fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 12, 40, 0, 0))
                os.kill(pid, signal.SIGWINCH)
                read_until(b"[Account]")
                read_until(b"[Sessions]")
                press(b"\x1b[Z", b"Left/Right tabs")
                press(b"\x1b[C", b"[Automation tokens]")
                read_until(b"CI token")
                press(b"p", b"Projects | 1 project")
                press(b"\r", b"deployment  static  healthy")
                os.write(master, b"q")
            elif mode == "account":
                read_until(b"admin@example.com")
                read_until(b"HTTP project")
                entered = b"\x1b[?1049h" in output
                assert not termios.tcgetattr(slave)[3] & termios.ICANON
                os.write(master, b"q")
            else:
                read_until(b"Browser-approved login")
                entered = b"\x1b[?1049h" in output
                assert not termios.tcgetattr(slave)[3] & termios.ICANON
                if mode == "suspend":
                    output.clear()
                    os.kill(pid, signal.SIGTSTP)
                    deadline = time.monotonic() + 5
                    stopped = False
                    while time.monotonic() < deadline:
                        if select.select([master], [], [], 0.02)[0]:
                            output.extend(os.read(master, 65536))
                        result, status = os.waitpid(pid, os.WNOHANG | os.WUNTRACED)
                        if result and os.WIFSTOPPED(status):
                            stopped = True
                            break
                    if not stopped:
                        while select.select([master], [], [], 0)[0]:
                            output.extend(os.read(master, 65536))
                    assert stopped, ("TUI did not suspend", bytes(output)[-4000:])
                    assert termios.tcgetattr(slave)[3] & termios.ICANON
                    output.clear()
                    os.kill(pid, signal.SIGCONT)
                    read_until(b"Browser-approved login")
                    assert not termios.tcgetattr(slave)[3] & termios.ICANON
                if mode == "resize":
                    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 8, 35, 0, 0))
                    os.kill(pid, signal.SIGWINCH)
                    read_until(b"Resize to at least")
                    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 30, 120, 0, 0))
                    output.clear()
                    os.kill(pid, signal.SIGWINCH)
                    read_until(b"Browser-approved login")
                if mode in ("signal", "hangup"):
                    os.kill(pid, signal.SIGHUP if mode == "hangup" else signal.SIGTERM)
                else:
                    os.write(master, b"edited")
                    time.sleep(0.05)
                    os.write(master, b"\x1b")
                    read_until(b"Discard this draft")
                    os.write(master, b"\x1b[C")
                    read_until(b"> Confirm")
                    output.clear()
                    os.write(master, b"\r")
                    read_until(b"Account")
                    os.write(master, b"q")
            deadline = time.monotonic() + 8
            status = None
            while time.monotonic() < deadline:
                if select.select([master], [], [], 0.05)[0]:
                    try:
                        output.extend(os.read(master, 65536))
                    except OSError:
                        pass
                result, candidate = os.waitpid(pid, os.WNOHANG)
                if result:
                    status = candidate
                    break
            assert status is not None, ("process did not quit", bytes(output)[-4000:])
            # Drain terminal teardown after the process has exited.
            while select.select([master], [], [], 0.05)[0]:
                try:
                    chunk = os.read(master, 65536)
                    if not chunk:
                        break
                    output.extend(chunk)
                except OSError:
                    break
            assert os.waitstatus_to_exitcode(status) == (130 if mode in ("signal", "hangup") else 0), bytes(output)[-4000:]
            after = termios.tcgetattr(slave)
            assert after[3] & (termios.ICANON | termios.ECHO) == before[3] & (termios.ICANON | termios.ECHO)
            assert b"\x1b]52;" not in output
            assert entered and b"\x1b[?1049l" in output
            assert b"\x1b[?25h" in output
        finally:
            try:
                os.kill(pid, signal.SIGKILL)
                os.waitpid(pid, 0)
            except ProcessLookupError:
                pass
            except ChildProcessError:
                pass
            os.close(master)
            os.close(slave)


run_case(sys.argv[3])
print(json.dumps({"mode": sys.argv[3], "restored": True}))
