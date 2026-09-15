# Deploying on a cloud VM

For running the assistant on a server instead of a laptop: a CSC cPouta
instance or a Google Cloud Compute Engine VM. Both are the same thing once
they exist, a Linux machine with Docker, so only step 1 differs.

## What it needs

| | Minimum | Comfortable |
|---|---|---|
| Memory | 4 GB | 8 GB |
| Cores | 2 | 4 |
| Disk | 20 GB | 40 GB |
| OS | Ubuntu 24.04 LTS | |

Measured on a running install: the app holds 1.7 GB once its embedding and
reranker models are loaded, the gateway 75 MB, Postgres 30 MB plus whatever the
page cache takes. Images and models are about 2 GB on disk; the database grows
with the chat. The reranker is the slow step and uses every core it gets, so
more cores means faster answers when several questions arrive together.

**No inbound port has to be open except SSH.** Slack (Socket Mode), WhatsApp,
Telegram, Discord and the LLM providers are all connections the VM makes
outwards. The panel listens on the VM's loopback only, and you reach it through
an SSH tunnel. Open 80 and 443 only if you want the panel at a public URL or
use the WhatsApp Cloud API channel, whose webhook Meta has to reach (step 7).

**Run one install at a time.** Slack hands each event to just one of the open
Socket Mode connections, so a laptop and a VM running side by side would each
see about half the messages. WhatsApp logs out a session used from two places.
Stop the old install before the new one connects (step 4 does this).

**The chats are personal data.** Pick a region in Finland or the EU, and check
your organisation's rules for where such data may live. On CSC, check that your
project's terms allow it on cPouta; data classed as sensitive belongs in
ePouta instead.

---

## 1a Create the VM on CSC cPouta

In [pouta.csc.fi](https://pouta.csc.fi), in your project:

1. **Compute → Key Pairs → Import Public Key**: paste your `~/.ssh/id_ed25519.pub`.
2. **Network → Security Groups → Create Security Group** named `ssh`, then
   **Manage Rules → Add Rule**: port `22`, CIDR your own address with `/32`
   (find it with `curl -s ifconfig.me`). Nothing else.
3. **Compute → Instances → Launch Instance**: image **Ubuntu-24.04**, a flavor
   with at least 4 GB memory and 2 cores, your key pair, and the `ssh`
   security group.
4. **Associate Floating IP** on the instance and note the address.
5. `ssh ubuntu@FLOATING_IP`

## 1b Create the VM on Google Cloud

With the [gcloud CLI](https://cloud.google.com/sdk/docs/install), in a project
with Compute Engine enabled. `europe-north1` is Hamina, Finland:

```
gcloud compute instances create assistant \
  --zone europe-north1-a \
  --machine-type e2-standard-2 \
  --image-family ubuntu-2404-lts-amd64 --image-project ubuntu-os-cloud \
  --boot-disk-size 30GB
gcloud compute ssh assistant --zone europe-north1-a
```

`e2-standard-2` is 2 cores and 8 GB. Leave **Allow HTTP/HTTPS traffic** off. A
new project's `default-allow-ssh` firewall rule accepts SSH from anywhere;
narrow its source range to your own address, or connect with
`gcloud compute ssh --tunnel-through-iap` and delete the rule.

---

## 2 Install Docker

On the VM:

```
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
sudo apt-get install -y git age
exit        # and ssh in again, so the docker group applies
```

Docker's installer enables the service at boot, which is what brings the
assistant back after a reboot.

## 3 Get the code

```
sudo mkdir -p /srv/wtsap-rag && sudo chown "$USER" /srv/wtsap-rag
git clone https://github.com/nasiriubat/wtsapp-rag.git /srv/wtsap-rag
cd /srv/wtsap-rag
git checkout "$(git tag --sort=-v:refname | head -1)"   # the newest release
mkdir -p gateway/auth_state gateway/data
sudo chown -R 1000:1000 gateway/auth_state gateway/data
```

The gateway runs as uid 1000 inside its container, so those two directories
must belong to it on the host.

## 4 Either move an existing install, or start fresh

### Moving from a laptop

Keeps every message, setting, provider key, channel token and the WhatsApp
pairing. On the **laptop**, in the repository:

```
docker compose stop gateway     # nothing new arrives while you copy
docker compose exec -T db pg_dump -U assistant -Fc assistant > assistant.dump
docker compose down             # not -v: the laptop's volumes stay as a fallback
tar czf move.tgz .env assistant.dump gateway/auth_state
scp move.tgz ubuntu@VM_ADDRESS:/srv/wtsap-rag/
rm assistant.dump move.tgz
```

The `.env` must travel with the dump: its `SECRET_KEY` is the only thing that
decrypts the keys and tokens inside it. On the **VM**:

```
cd /srv/wtsap-rag
tar xzf move.tgz && rm move.tgz
chmod 600 .env
sudo chown -R 1000:1000 gateway/auth_state
docker compose up -d db
until docker compose exec -T db pg_isready -U assistant -d assistant; do sleep 2; done
docker compose exec -T db pg_restore -U assistant -d assistant --no-owner < assistant.dump
rm assistant.dump
docker compose up -d --build
```

WhatsApp usually carries on with the copied pairing. If the Channels page shows
it asking for a QR instead, press **Settings** on the WhatsApp card, then
**Link a different number**, and scan again;
nothing stored is lost.

### Starting fresh

Follow sections 1 and 2 of [SETUP.md](SETUP.md) on the VM: fill in `.env`,
`chmod 600 .env`, `docker compose up -d --build`. The first start downloads
about 1 GB of models.

## 5 Open the panel

From your own machine, keep this running while you use the panel:

```
ssh -N -L 8000:127.0.0.1:8000 ubuntu@VM_ADDRESS
# or, on Google Cloud:
gcloud compute ssh assistant --zone europe-north1-a -- -N -L 8000:127.0.0.1:8000
```

Then open **http://localhost:8000/admin** on your own machine. The traffic
travels inside SSH, so nothing about the panel is exposed to the internet.

## 6 Check it

- `docker compose ps`: db, app and gateway all `healthy`.
- `curl -s localhost:8000/health` on the VM: `"db": "ok"` and the version.
- Channels page: each enabled channel green.
- Ask a question in a Slack channel or WhatsApp group and see the answer.
- `sudo reboot`, wait a minute, ssh in, `docker compose ps` again: all three
  come back on their own.

## 7 Optional: a public URL

Only if you want the panel without a tunnel, or need the WhatsApp Cloud API
webhook. [Caddy](https://caddyserver.com) on the host gets and renews the TLS
certificate by itself.

1. Point a DNS name at the VM, e.g. `assistant.example.org`.
2. Open ports 80 and 443: on cPouta add both to a security group; on Google
   Cloud add a firewall rule for `tcp:80,tcp:443`.
3. On the VM: `sudo apt-get install -y caddy`, then put this in
   `/etc/caddy/Caddyfile` and `sudo systemctl reload caddy`:

   ```
   assistant.example.org {
       handle /webhook/* {
           reverse_proxy 127.0.0.1:8080
       }
       handle {
           reverse_proxy 127.0.0.1:8000
       }
   }
   ```

   Drop the `/webhook/*` block if you do not use the Cloud API.

The panel then has a real address on the internet, guarded by
`ADMIN_PASSWORD` and the five-attempt lockout, so make that password long.
`TRUSTED_PROXY`'s default already covers a proxy on the same machine, and the
session cookie is marked Secure because Caddy reports HTTPS.

## 8 Backups

The nightly encrypted dump in [OPERATIONS.md](OPERATIONS.md#backup) applies
as written; the repository path there is already `/srv/wtsap-rag`. Send the
file off the VM: to CSC Allas on cPouta, or to a Cloud Storage bucket
(`gcloud storage cp`) on Google Cloud. Keep a copy of `.env` somewhere else
again.

## 9 Upgrades

```
cd /srv/wtsap-rag
git fetch --tags && git checkout vX.Y.Z
docker compose up -d --build
```

Migrations run when the app starts. Take a backup first; there is no down
migration.
