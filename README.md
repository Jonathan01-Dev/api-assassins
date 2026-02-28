# Archipel Hackathon
TITRE : ARCHIPEL - Secure P2P Offline Network

DESCRIPTION 
Archipel is a decentralised peer-to-peer system designed to work without connectivity as long as the hosts are in the same network.
Nodes automaticaly discover each other on the local network using UDP multicast and communicate via TCP connections. 


TECHNOLOGY STACK
- Node.js
-  UDP(User Datagram Protocol) Multicast (Peer Discovery)
- TCP (Node-to-Node commuication)
- libsodium (for cryptography) 
- Native Node.js modules (net, dgram, crypto)

ARCHITECTURE
+-------------------+
    |      Node A       |
    |-------------------|
    | TCP Server        |
    | UDP Discovery     |
    | Peer Table        |
    +-------------------+
             ↑
             |  UDP Multicast (HELLO)
             ↓
    +-------------------+
    |      Node B       |
    |-------------------|
    | TCP Server        |
    | UDP Discovery     |
    | Peer Table        |
    +-------------------+


PACKET FORMAT (Protocol v1)
Each network message follows this structure :
| Field        | Size      | Description |
|-------------|-----------|-------------|
| MAGIC       | 4 bytes   | Protocol identifier |
| TYPE        | 1 byte    | Message type |
| NODE_ID     | 32 bytes  | Unique node identifier |
| PAYLOAD_LEN | 4 bytes   | Payload length |
| PAYLOAD     | Variable  | Encrypted data |
| HMAC        | 32 bytes  | Integrity check |


MESSAGE TYPES
- 0x01 HELLO
- 0x02 PEER_LIST
- 0x03 MSG
- 0x04 CHUNK_REQ
- 0x05 CHUNK_DATA
- 0x06 MANIFEST
- 0x07 ACK


HOW TO RUN (Sprint 1)
Install dependencies:
- npm install
- Run three nodes in separate terminals:
- Terminal 1:
set TCP_PORT=7777 && node src/index.js
- Terminal 2:
set TCP_PORT=7778 && node src/index.js
- Terminal 3:
set TCP_PORT=7779 && node src/index.js


CURRENT STATUS (End of Sprint )
- UDP multicast peer discovery implemented
- Dynamic peer table with timeout
- TCP server operational
- Multi-node local testing validated