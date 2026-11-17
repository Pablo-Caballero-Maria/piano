"""tools/configure.py: the questions ./install.sh asks to fill in .env."""

import stat

import pytest

from fog.settings import Settings, load_env_file, public_url
from pianocore.crypto import Keys, new_system_key
from tools.configure import QUESTIONS, EnvFile, configure

TOKEN = "1a2b3c4d-1a2b-1a2b-1a2b-1a2b3c4d5e6f"
TEMPLATE = """# The template's comment
PIANO_DATA_KEY=
PIANO_BOARD_ID=piano1
PIANO_PUBLIC_URL=
DUCKDNS_DOMAIN=
DUCKDNS_TOKEN=
WIFI_SSID=
WIFI_PASSWORD=
MONGODB_URI=
ABLY_API_KEY=
"""


class Answers:
    """Typed answers, by variable name (a list: one per time it's asked)."""

    def __init__(self, **answers):
        self.answers = {k: list(v) if isinstance(v, list) else [v] for k, v in answers.items()}
        self.asked, self.prompts, self.said = [], [], []

    def __call__(self, prompt: str) -> str:
        key = prompt.split(" ")[0].rstrip(":")
        self.asked.append(key)
        self.prompts.append(prompt)
        queue = self.answers.get(key)
        if not queue:
            raise AssertionError(f"unexpected question {key}")
        return queue.pop(0)

    def say(self, text: str) -> None:
        self.said.append(text)


def run(env, answers, everything=False):
    return configure(env, everything, ask=answers, ask_secret=answers, say=answers.say)


@pytest.fixture
def paths(tmp_path):
    template = tmp_path / ".env.example"
    template.write_text(TEMPLATE)
    return tmp_path / ".env", template


def test_first_time_asks_everything_and_writes_a_private_env(paths):
    path, template = paths
    key = new_system_key()
    answers = Answers(
        PIANO_DATA_KEY=key,
        DUCKDNS_DOMAIN="Piano-Aula3.duckdns.org",
        DUCKDNS_TOKEN=TOKEN,
        WIFI_SSID="Aula 3",
        WIFI_PASSWORD="p#ss=word&x",
        MONGODB_URI="",
        ABLY_API_KEY="",
    )
    env = EnvFile(path, template)
    run(env, answers)
    env.save()
    assert answers.asked == [q.key for q in QUESTIONS]
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    text = path.read_text()
    assert text.startswith("# The template's comment\n")  # the template's comments are kept
    values = load_env_file(path)
    assert values["PIANO_DATA_KEY"] == key
    assert values["DUCKDNS_DOMAIN"] == "piano-aula3"
    assert values["WIFI_PASSWORD"] == "p#ss=word&x"  # read back exactly
    assert values["MONGODB_URI"] == ""
    settings = Settings.load(path)
    assert settings.public_url == "https://piano-aula3.duckdns.org"
    assert settings.board_id == "piano1"


def test_an_empty_system_key_starts_a_new_system(paths):
    path, template = paths
    env = EnvFile(path, template)
    answers = Answers(
        PIANO_DATA_KEY="", DUCKDNS_DOMAIN="x", DUCKDNS_TOKEN=TOKEN, WIFI_SSID="a", WIFI_PASSWORD="",
        MONGODB_URI="", ABLY_API_KEY="",
    )  # fmt: skip
    run(env, answers)
    Keys.from_text(env.get("PIANO_DATA_KEY"))  # a valid key
    assert any("new system key" in s for s in answers.said)


def test_wrong_answers_are_asked_again(paths):
    path, template = paths
    answers = Answers(
        PIANO_DATA_KEY=["not a key", new_system_key()],
        DUCKDNS_DOMAIN=["piano aula", "piano-aula"],
        DUCKDNS_TOKEN=["123", TOKEN.upper()],
        WIFI_SSID=["", "Aula"],  # needed: empty isn't accepted
        WIFI_PASSWORD="",
        MONGODB_URI=["http://atlas", "mongodb+srv://u:p@c.mongodb.net/"],
        ABLY_API_KEY=["nokey", "app.key:secret"],
    )
    env = EnvFile(path, template)
    run(env, answers)
    assert env.get("DUCKDNS_TOKEN") == TOKEN  # stored in lower case
    assert env.get("ABLY_API_KEY") == "app.key:secret"
    assert sum("doesn't look right" in s for s in answers.said) == 5
    assert any("needed" in s for s in answers.said)


def test_later_runs_ask_only_what_is_missing(paths):
    path, _ = paths
    path.write_text(
        f"PIANO_DATA_KEY={new_system_key()}\nDUCKDNS_DOMAIN=aula\nDUCKDNS_TOKEN=\nWIFI_SSID=Aula\n"
    )
    path.chmod(0o600)
    answers = Answers(DUCKDNS_TOKEN=TOKEN)
    env = EnvFile(path)
    assert run(env, answers) == ["DUCKDNS_TOKEN", "PIANO_BOARD_ID"]
    assert answers.asked == ["DUCKDNS_TOKEN"]  # not the optional ones, nor the WiFi password


def test_asking_everything_again_keeps_values_on_enter(paths):
    path, _ = paths
    key = new_system_key()
    path.write_text(
        f"PIANO_DATA_KEY={key}\nPIANO_PUBLIC_URL=https://old.duckdns.org\nDUCKDNS_DOMAIN=old\n"
        f"DUCKDNS_TOKEN={TOKEN}\nWIFI_SSID=Aula\nWIFI_PASSWORD=secret1\n"
    )
    answers = Answers(
        PIANO_DATA_KEY="", DUCKDNS_DOMAIN="new", DUCKDNS_TOKEN="", WIFI_SSID="", WIFI_PASSWORD="",
        MONGODB_URI="", ABLY_API_KEY="",
    )  # fmt: skip
    env = EnvFile(path)
    changed = run(env, answers, everything=True)
    assert changed == ["DUCKDNS_DOMAIN", "PIANO_PUBLIC_URL", "PIANO_BOARD_ID"]
    assert env.get("PIANO_DATA_KEY") == key  # Enter kept it (no new system)
    assert env.get("WIFI_PASSWORD") == "secret1"
    assert (
        public_url({k: env.get(k) for k in ("PIANO_PUBLIC_URL", "DUCKDNS_DOMAIN")})
        == "https://new.duckdns.org"
    )
    shown = " ".join(answers.said + answers.prompts)
    assert "…ret1" in shown  # recognisable…
    assert "secret1" not in shown and key not in shown  # …but secrets are never printed back


def test_public_url():
    assert public_url({}) == "https://localhost"
    assert public_url({"DUCKDNS_DOMAIN": "aula.duckdns.org"}) == "https://aula.duckdns.org"
    assert (
        public_url({"DUCKDNS_DOMAIN": "aula", "PIANO_PUBLIC_URL": "https://piano.example/"})
        == "https://piano.example"
    )


def test_values_with_line_breaks_are_refused(tmp_path):
    env = EnvFile(tmp_path / ".env")
    with pytest.raises(ValueError):
        env.set("WIFI_SSID", "a\nPIANO_DATA_KEY=x")
