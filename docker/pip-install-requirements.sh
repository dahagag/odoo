#!/bin/sh
set -eu

# Some base-image environments ship an apt-installed cryptography/pyopenssl pip can't
# account for (no RECORD file), so a plain upgrade fails with "Cannot uninstall ...
# installed by debian". --ignore-installed forces a clean pip-tracked reinstall of just
# those two (version-pinned via -c against requirements.txt, not hardcoded here) before
# the bulk install runs normally for everything else.
python3 -m pip install --no-cache-dir --break-system-packages --ignore-installed -c /tmp/odoo-requirements.txt cryptography pyopenssl
python3 -m pip install --no-cache-dir --break-system-packages -r /tmp/odoo-requirements.txt
