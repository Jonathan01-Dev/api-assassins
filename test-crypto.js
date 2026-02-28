// test-crypto.js
const sodium = require("libsodium-wrappers");
const { createKxKeypair, deriveSessionKeys } = require("./src/crypto/handshake");
const { encrypt, decrypt } = require("./src/crypto/aead");

(async () => {
  await sodium.ready;

  // 1) Keypairs (X25519)
  const clientKp = await createKxKeypair();
  const serverKp = await createKxKeypair();

  // 2) Session keys (IMPORTANT: client vs server)
  const clientKeys = await deriveSessionKeys("client", clientKp, serverKp.publicKey);
  const serverKeys = await deriveSessionKeys("server", serverKp, clientKp.publicKey);

  // 3) Vérif rx/tx match (doivent être "croisés")
  const txClient_eq_rxServer = sodium.memcmp(clientKeys.tx, serverKeys.rx);
  const rxClient_eq_txServer = sodium.memcmp(clientKeys.rx, serverKeys.tx);

  console.log("client.tx == server.rx ?", txClient_eq_rxServer);
  console.log("client.rx == server.tx ?", rxClient_eq_txServer);

  if (!txClient_eq_rxServer || !rxClient_eq_txServer) {
    console.error("❌ Session keys mismatch: rôle client/server ou publicKey échangées incorrectement");
    process.exit(1);
  }

  // 4) Message client -> server (client chiffre avec tx, serveur déchiffre avec rx)
  const msg1 = "Hello server 👋";
  const msg1U8 = sodium.from_string(msg1);

  const enc1 = await encrypt(clientKeys.tx, msg1U8, null);
  const dec1U8 = await decrypt(serverKeys.rx, enc1.nonce, enc1.ciphertext, null);
  const dec1 = sodium.to_string(dec1U8);

  console.log("Decrypted (server):", dec1);
  console.log("OK msg1 ?", dec1 === msg1);

  // 5) Message server -> client (server chiffre avec tx, client déchiffre avec rx)
  const msg2 = "Hello client ✅";
  const msg2U8 = sodium.from_string(msg2);

  const enc2 = await encrypt(serverKeys.tx, msg2U8, null);
  const dec2U8 = await decrypt(clientKeys.rx, enc2.nonce, enc2.ciphertext, null);
  const dec2 = sodium.to_string(dec2U8);

  console.log("Decrypted (client):", dec2);
  console.log("OK msg2 ?", dec2 === msg2);

  // 6) Test d’échec attendu (mauvaise clé)
  try {
    await decrypt(clientKeys.tx, enc2.nonce, enc2.ciphertext, null); // clé volontairement fausse
    console.log("❌ Unexpected: decrypt succeeded with wrong key");
  } catch (e) {
    console.log("✅ Expected failure with wrong key (good):", e.message);
  }
})();