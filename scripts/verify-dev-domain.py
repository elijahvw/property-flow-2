"""Read-only HTTPS gate for the manually configured development hostname."""
import argparse
import json
from pathlib import Path
import re
from urllib.error import URLError
from urllib.parse import urlsplit
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "infra/terraform/envs/dev/custom-domain.auto.tfvars.json"


def configured_origin(config):
    domain = config["frontend_custom_domain"]
    if domain is None:
        origin = config["app_origin"]
        parsed = urlsplit(origin)
        if parsed.scheme != "https" or not parsed.hostname or parsed.netloc != parsed.hostname or parsed.path or parsed.query or parsed.fragment:
            raise ValueError("Rollback app_origin must be an HTTPS origin without a path.")
        return origin
    hostname = domain["hostname"]
    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+", hostname):
        raise ValueError("Custom-domain configuration must contain a DNS hostname without a scheme or path.")
    return f"https://{hostname}"


def public_url(config_path=CONFIG):
    return configured_origin(json.loads(config_path.read_text()))


def verify(config_path=CONFIG, open_url=urlopen):
    config = json.loads(config_path.read_text())
    origin = configured_origin(config)
    if config["frontend_custom_domain"] is None:
        return "Custom domain explicitly disabled; using the original application origin."
    hostname = config["frontend_custom_domain"]["hostname"]
    try:
        # urllib uses certificate/hostname validation. The static homepage is
        # available even when the development database is stopped.
        with open_url(origin + "/", timeout=15) as response:
            final_url = urlsplit(response.url)
            if response.status != 200 or final_url.scheme != "https" or final_url.netloc != hostname:
                raise ValueError("The configured hostname must serve its own HTTPS homepage with HTTP 200.")
    except (URLError, OSError) as error:
        raise RuntimeError("Custom-domain HTTPS is not ready. Complete ACM validation, CloudFront alias/certificate setup and GoDaddy DNS before deploying.") from error
    return f"Custom-domain HTTPS verified: {origin}"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", action="store_true", help="Print the configured public URL without reading Terraform state or making network requests.")
    args = parser.parse_args()
    print(public_url() if args.url else verify())


if __name__ == "__main__":
    main()
