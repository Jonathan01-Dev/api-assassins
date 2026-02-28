# Archipel - Secure Offline P2P

Implémentation complète du protocole Archipel en Node.js:
- découverte P2P sans Internet (UDP multicast)
- tunnel chiffré pair-à-pair (X25519 + XChaCha20-Poly1305)
- authentification sans CA (TOFU / Web of Trust)
- messages chiffrés
- transfert fichiers par chunks avec vérification SHA-256
- CLI opérationnelle + site web local de supervision

## 1) Architecture

Chaque nœud exécute:
- un serveur TCP (données chiffrées)
- un module de découverte UDP multicast
- une table de pairs + réputation
- un moteur de transfert par chunks
- une API locale HTTP + dashboard web

```
Node A <--- UDP HELLO ---> Node B
Node A <=== TCP chiffré ===> Node B
```

## 2) Cryptographie utilisée

- Identité nœud: Ed25519
- Échange de clés de session: X25519 (ephemeral)
- Chiffrement transport: XChaCha20-Poly1305
- Intégrité paquet Archipel: HMAC-SHA256
- Intégrité chunks/fichiers: SHA-256

## 3) Installation

```bash
cd /home/vianekisdead/api-assassins
npm install
```

## 3.1) Workflow équipe (commits/push structurés)

Pour synchroniser souvent sans faire de faux commits:

```bash
# une seule tentative (test + commit/push si changements)
npm run team:sync:once

# boucle auto toutes les 30 secondes (commit/push seulement si changements)
npm run team:autosync

# boucle auto + tests avant chaque commit
npm run team:autosync:test
```

Options avancées:

```bash
bash scripts/team-autosync.sh --interval 45 --run-tests --branch main --remote origin
```

Le script:
- ne commit/push que s'il y a de vrais changements
- fait `git pull --rebase --autostash` avant commit
- saute le push si les tests échouent (mode `--run-tests`)

## 4) Démarrer un nœud

```bash
node src/cli.js start --port 7777 --admin-port 8787 [--no-ai] [--ad-hoc]
```

Dashboard web:
- http://127.0.0.1:8787

Par défaut, les données du nœud sont stockées dans:
- `.archipel/node-<port>`

## 5) Commandes CLI (alignées Sprint 4)

```bash
node src/cli.js status --admin-port 8787
node src/cli.js peers --admin-port 8787
node src/cli.js hello --admin-port 8787
node src/cli.js msg <node_id> "Hello" --admin-port 8787
node src/cli.js send <node_id> /tmp/fichier.bin --admin-port 8787
node src/cli.js ai "propose une réponse simple" --admin-port 8787
node src/cli.js ai-status --admin-port 8787
node src/cli.js key-revoke --admin-port 8787
node src/cli.js receive --admin-port 8787
node src/cli.js download <file_id> --admin-port 8787
node src/cli.js trust <node_id> --admin-port 8787
node src/cli.js stop --admin-port 8787
```

## 6) Démo rapide (2 nœuds)

Terminal A:
```bash
node src/cli.js start --port 7777 --admin-port 8787 --data-dir /tmp/arch-a
```

Terminal B:
```bash
node src/cli.js start --port 7778 --admin-port 8788 --data-dir /tmp/arch-b
```

Puis:
```bash
node src/cli.js status --admin-port 8787
node src/cli.js status --admin-port 8788
node src/cli.js peers --admin-port 8787
```

Envoyer message A -> B:
```bash
node src/cli.js msg <NODE_ID_B> "salut" --admin-port 8787
```

Envoyer fichier A -> B:
```bash
node src/cli.js send <NODE_ID_B> /tmp/arch-e2e.bin --admin-port 8787
node src/cli.js receive --admin-port 8788
node src/cli.js download <FILE_ID> --admin-port 8788
```

Mode ad-hoc (sans multicast, pair manuel):

Terminal A:
```bash
node src/cli.js start --port 7777 --admin-port 8787 --ad-hoc --data-dir /tmp/arch-a
```

Terminal B:
```bash
node src/cli.js start --port 7778 --admin-port 8788 --ad-hoc --data-dir /tmp/arch-b
```

Puis ajouter les peers manuellement et forcer HELLO:

```bash
node src/cli.js peer-add <NODE_ID_B> 192.168.1.20:7778 --admin-port 8787
node src/cli.js peer-add <NODE_ID_A> 192.168.1.10:7777 --admin-port 8788
node src/cli.js hello --admin-port 8787
node src/cli.js hello --admin-port 8788
```

## 7) Structure projet

```
src/
  protocol/      format paquet Archipel v1
  crypto/        identité + key exchange + AEAD
  network/       discovery multicast + frames + secure channel
  node/          runtime principal du nœud
  admin/         API locale HTTP
  cli.js         commandes utilisateur
apps/web/        site web local (dashboard + actions)
```

## 8) Notes importantes

- Pas de serveur central.
- Fonctionne en LAN local sans Internet.
- Le chat P2P reste offline; Gemini est optionnel via l’API locale.
- Pour forcer le mode offline IA: lancer avec `--no-ai` (ou `ARCHIPEL_NO_AI=1`).
- Pour forcer la découverte ad-hoc (sans multicast): lancer avec `--ad-hoc` (ou `ARCHIPEL_ADHOC=1`).
- Pour lancer plusieurs nœuds sur la même machine: utiliser des `--data-dir` et ports différents.

## 9) Intégration Gemini (optionnelle)

Configurer la clé API dans l'environnement:

```bash
export GEMINI_API_KEY="ta_cle_api"
export GEMINI_MODEL="gemini-2.0-flash"
```

Ou via fichier local `.env` (chargé automatiquement par `src/cli.js` et `src/index.js`):

```bash
GEMINI_API_KEY=ta_cle_api
GEMINI_MODEL=gemini-2.0-flash
```

Puis démarrer le nœud:

```bash
node src/cli.js start --port 7777 --admin-port 8787
```

Endpoints Gemini disponibles:
- `GET /api/ai/status` -> état config + mode `--no-ai`
- `POST /api/ai/generate` -> génération texte
- `POST /api/security/revoke-key` -> prépare une nouvelle clé locale (redémarrage requis)
- `GET /api/trust-store` -> empreintes et niveaux de confiance

Exemple:

```bash
curl -s -X POST http://127.0.0.1:8787/api/ai/generate \
  -H "content-type: application/json" \
  -d '{"prompt":"Réponds en français simple: bonjour"}'
```

Dans l'interface web, bouton `Réponse IA` dans la zone de message:
- lit le contexte récent de conversation
- génère un brouillon Gemini
- remplit le champ message automatiquement

Commandes chat UI:
- `/ask ...` -> génère une réponse IA (si IA activée)
- `@archipel-ai ...` -> même comportement
