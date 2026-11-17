"""The shell scripts: valid bash, and every @PLACEHOLDER@ in deploy/'s templates is filled in."""

import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = [ROOT / "install.sh", *sorted((ROOT / "deploy").glob("*.sh"))]


@pytest.mark.skipif(not shutil.which("bash"), reason="no bash")
@pytest.mark.parametrize("script", SCRIPTS, ids=lambda p: p.name)
def test_bash_syntax(script):
    subprocess.run(["bash", "-n", str(script)], check=True)


def test_install_sh_is_executable():
    assert (ROOT / "install.sh").stat().st_mode & 0o111


def test_every_placeholder_is_filled():
    setup = (ROOT / "deploy" / "setup.sh").read_text()
    filled = set(re.findall(r"s\|@(\w+)@\|", setup))
    for template in (ROOT / "deploy").iterdir():
        if template.name == "setup.sh":
            continue
        used = set(re.findall(r"@([A-Z_]+)@", template.read_text()))
        assert used <= filled, f"{template.name}: {used - filled} not filled by setup.sh"
