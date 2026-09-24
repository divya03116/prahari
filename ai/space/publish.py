"""Publishes the PRAHARI AI service as a Hugging Face Space and points the
hosted website at it.

    python ai/space/stage.py      # first: server + weights + metrics
    python ai/space/publish.py [--build E:/prahari-ml/space-build] [--no-website]

Needs `hf auth login` (a Write token) first. Creates or updates the public
Docker Space <user>/prahari-ai from the staged folder, waits until it serves
the models, then sets VITE_PPE_INFERENCE_URL for the website (.env.vercel and
the Vercel project, production and preview) and rebuilds production.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import time
import urllib.request
from pathlib import Path

from huggingface_hub import HfApi

REPO = Path(__file__).resolve().parents[2]
SITE = "https://prahari-silk.vercel.app"
SPACE_NAME = "prahari-ai"


def wait_ready(url: str, minutes: int = 30) -> dict | None:
    """The model description once the Space answers, or None on timeout."""
    deadline = time.time() + minutes * 60
    while time.time() < deadline:
        try:
            req = urllib.request.Request(f"{url}/v1/model", headers={"Origin": SITE})
            with urllib.request.urlopen(req, timeout=60) as res:
                return json.load(res)
        except Exception:  # building, starting or waking up
            print("  waiting for the Space to build and start...", flush=True)
            time.sleep(30)
    return None


def vercel(*args: str, stdin: str | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["npx.cmd", "--yes", "vercel@59", *args], cwd=REPO, input=stdin, capture_output=True, text=True
    )


def point_website(url: str) -> None:
    env_file = REPO / ".env.vercel"
    if env_file.exists():
        text = env_file.read_text(encoding="utf-8")
        line = f"VITE_PPE_INFERENCE_URL={url}"
        text = re.sub(r"^VITE_PPE_INFERENCE_URL=.*$", line, text, flags=re.M) if "VITE_PPE_INFERENCE_URL=" in text else text + f"\n{line}\n"
        env_file.write_text(text, encoding="utf-8")
        print("  .env.vercel updated")
    for target in ("production", "preview"):
        vercel("env", "rm", "VITE_PPE_INFERENCE_URL", target, "--yes")
        added = vercel("env", "add", "VITE_PPE_INFERENCE_URL", target, stdin=url)
        print(f"  Vercel {target}: {'set' if added.returncode == 0 else 'FAILED - ' + added.stderr.strip()[-200:]}")
    print("  rebuilding the website (about a minute)...")
    rebuilt = vercel("redeploy", SITE.removeprefix("https://"), "--target", "production")
    print("  website rebuilt" if rebuilt.returncode == 0 else f"  rebuild FAILED - {rebuilt.stderr.strip()[-300:]}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--build", default="E:/prahari-ml/space-build")
    parser.add_argument("--no-website", action="store_true", help="publish the Space only")
    args = parser.parse_args()
    build = Path(args.build)
    if not (build / "Dockerfile").exists():
        raise SystemExit(f"Nothing staged in {build}. Run: python ai/space/stage.py")

    api = HfApi()
    user = api.whoami()["name"]
    repo_id = f"{user}/{SPACE_NAME}"
    print(f"Publishing {repo_id} (public Docker Space)...")
    api.create_repo(repo_id, repo_type="space", space_sdk="docker", exist_ok=True)
    api.upload_folder(repo_id=repo_id, repo_type="space", folder_path=str(build), commit_message="Update PRAHARI AI service")
    url = (api.space_info(repo_id).host or f"https://{re.sub(r'[^a-z0-9]+', '-', repo_id.lower())}.hf.space").rstrip("/")
    print(f"  uploaded - https://huggingface.co/spaces/{repo_id}")
    print(f"  service address: {url}")

    model = wait_ready(url)
    if not model:
        raise SystemExit("The Space did not start within 30 minutes - see its Logs tab on Hugging Face.")
    roles = [m.get("role") for m in model.get("models", [])] or [model.get("name")]
    print(f"  serving: {', '.join(r for r in roles if r)}")

    if not args.no_website:
        point_website(url)
    print(f"\nDone. The website now uses the AI service at {url} on every device.")


if __name__ == "__main__":
    main()
