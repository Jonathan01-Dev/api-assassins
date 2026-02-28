# ARCHIPEL PACKET v1

Format binaire interne (après tunnel chiffré):

- MAGIC: 4 bytes (`ARCH`)
- TYPE: 1 byte
- NODE_ID: 32 bytes (Ed25519 public key)
- PAYLOAD_LEN: 4 bytes (uint32 BE)
- PAYLOAD: variable (JSON UTF-8)
- HMAC: 32 bytes (HMAC-SHA256)

## Types

- `0x01` HELLO
- `0x02` PEER_LIST
- `0x03` MSG
- `0x04` CHUNK_REQ
- `0x05` CHUNK_DATA
- `0x06` MANIFEST
- `0x07` ACK

## Handshake transport

À l'ouverture TCP, chaque côté envoie un frame `FRAME_KX_PUB` avec:
- clé Ed25519 publique
- clé X25519 éphémère
- signature Ed25519 du challenge

Après vérification (TOFU/Web of Trust), les clés session `rx/tx` sont dérivées via X25519.
Ensuite tous les paquets Archipel sont envoyés dans `FRAME_ENCRYPTED`.

## Découverte des pairs

Deux modes supportés:

- `multicast` (défaut): HELLO envoyé sur `239.255.42.99:<udpPort>`
- `ad-hoc`: HELLO envoyé en unicast UDP vers les IP des peers ajoutés manuellement

## Chunking

- chunk size par défaut: `524288` (512 KB)
- chaque chunk a son hash SHA-256
- le fichier final est validé via `file_id = sha256(file)`
