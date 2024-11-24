const express = require("express");
const app = express();
const dotEnv = require("dotenv");
const cors = require("cors");
const Hyperswarm = require("hyperswarm");
const goodbye = require("graceful-goodbye");
const crypto = require("hypercore-crypto");
const b4a = require("b4a");

dotEnv.config();
app.use(cors());

// Global variables for managing peers and messages
const peerConnections = {};
const messageHistory = [];

// Create a single Hyperswarm instance
const swarm = new Hyperswarm();
goodbye(() => swarm.destroy());

// Event listener for incoming peer connections
swarm.on("connection", (conn) => {
  const peerId = b4a.toString(conn.remotePublicKey, "hex");
  console.log(`* Connected to peer: ${peerId} *`);

  // Store the connection for broadcasting
  peerConnections[peerId] = conn;

  // Listen for incoming messages from this peer
  conn.on("data", (data) => {
    const msg = data.toString();
    console.log(`${peerId}: ${msg}`);
    
    // Save to message history
    messageHistory.push({ peerId, msg });
    
    // Broadcast the message to all connected peers
    broadcastMessage(peerId, msg);
  });

  // Handle connection close
  conn.once("close", () => {
    console.log(`* Peer disconnected: ${peerId} *`);
    delete peerConnections[peerId];
  });
});

// Function to broadcast messages to all connected peers
const broadcastMessage = (senderId, msg) => {
  Object.entries(peerConnections).forEach(([peerId, conn]) => {
    if (peerId !== senderId) {
      conn.write(`${senderId}: ${msg}`);
    }
  });
};

// Generate a new peer ID and join the swarm
app.get("/api/get-peer-id", (req, res) => {
  const peerId = crypto.randomBytes(32);
  const peerIdHex = b4a.toString(peerId, "hex");
  const discovery = swarm.join(peerId, { client: true, server: true });

  // Confirm the topic has been announced
  discovery.flushed().then(() => {
    console.log(`Peer ID ready: ${peerIdHex}`);
    res.json({ peerId: peerIdHex });
  });
});

// Connect to a peer using a peer ID
app.get("/api/connect-peers", (req, res) => {
  const { peerId } = req.query;
  if (!peerId) return res.status(400).json({ error: "peerId is required" });

  const topic = b4a.from(peerId, "hex");
  swarm.join(topic, { client: true, server: true });

  console.log(`Connecting to peer: ${peerId}`);
  res.json({ message: `Attempting to connect to peer: ${peerId}` });
});

// Get all messages sent/received
app.get("/api/messages", (req, res) => {
  res.json({ messages: messageHistory });
});

app.listen(process.env.SERVER_PORT, () => {
  console.log(`Server running on port ${process.env.SERVER_PORT}`);
});
