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

## 4) Démarrer un nœud

```bash
node src/cli.js start --port 7777 --admin-port 8787
```

Dashboard web:
- http://127.0.0.1:8787

Par défaut, les données du nœud sont stockées dans:
- `.archipel/node-<port>`

## 5) Commandes CLI (alignées Sprint 4)

```bash
node src/cli.js status --admin-port 8787
node src/cli.js peers --admin-port 8787
node src/cli.js msg <node_id> "Hello" --admin-port 8787
node src/cli.js send <node_id> /tmp/fichier.bin --admin-port 8787
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
- Gemini API non intégrée ici (mode 100% offline).
- Pour lancer plusieurs nœuds sur la même machine: utiliser des `--data-dir` et ports différents.
