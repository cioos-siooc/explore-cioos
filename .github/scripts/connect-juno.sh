#!/usr/bin/env bash
# Bring up the Juno WireGuard tunnel and the runner's SSH key for on-host.sh.
# The deploy action is then called with an empty wg_config so it doesn't try
# to bring the same interface up again.
#   WG_CONFIG, SSH_KEY: the secrets; HOSTS: space-separated hosts to trust
set -euo pipefail

sudo apt-get install -y wireguard >/dev/null
sed '/^DNS\s*=/Id' <<<"$WG_CONFIG" | sudo tee /etc/wireguard/wg0.conf >/dev/null
sudo chmod 600 /etc/wireguard/wg0.conf
sudo wg-quick up wg0

mkdir -p ~/.ssh
printf '%s\n' "$SSH_KEY" >~/.ssh/deploy_key
chmod 600 ~/.ssh/deploy_key
for host in $HOSTS; do
  ping -c 3 "$host" >/dev/null
  ssh-keyscan "$host" >>~/.ssh/known_hosts 2>/dev/null
done
