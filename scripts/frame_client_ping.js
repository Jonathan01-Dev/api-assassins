// Alias pratique: même comportement que secure_client_ping mais avec
// port par défaut orienté test tcpServer.js (7999).
if (!process.argv[2]) process.argv[2] = "127.0.0.1";
if (!process.argv[3]) process.argv[3] = "7999";
require("./secure_client_ping");
