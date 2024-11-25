const express = require("express");
const app = express();
const dotEnv = require("dotenv");
const bodyParser = require("body-parser");
const cors = require("cors");
const Hyperswarm = require("hyperswarm");
const goodbye = require("graceful-goodbye");
const crypto = require("hypercore-crypto");
const b4a = require("b4a");
const fs = require("fs/promises");  // Use promise-based fs

dotEnv.config();

// Middleware
app.use(cors());
app.use(bodyParser.json());  // Add JSON parsing
app.use(bodyParser.urlencoded({ extended: false }));

// State management
let activeConnections = new Map();
let currentChat = "";

const connectPeers = async (peerId, msg) => {
  try {
    const swarm = new Hyperswarm();
    goodbye(() => swarm.destroy());

    // Connection handler
    swarm.on("connection", (conn) => {
      const name = b4a.toString(conn.remotePublicKey, "hex");
      console.log("* got a connection from:", name, "*");
      
      activeConnections.set(name, conn);
      
      conn.once("close", () => {
        activeConnections.delete(name);
        console.log(`Connection closed: ${name}`);
      });

      conn.on("data", async (data) => {
        try {
          const message = data.toString();
          console.log(`${name}: ${message}`);
          
          const messageObject = {
            name,
            message,
            timestamp: new Date().toISOString()
          };

          currentChat = message;
          await fs.writeFile(
            "message.txt",
            JSON.stringify(messageObject, null, 2)
          );
        } catch (error) {
          console.error("Error handling message:", error);
        }
      });

      // Send initial message if provided
      if (msg) {
        conn.write(msg);
      }
    });

    // Error handler for swarm
    swarm.on("error", (error) => {
      console.error("Swarm error:", error);
    });

    // Join topic
    const topic = peerId 
      ? b4a.from(peerId, "hex")
      : crypto.randomBytes(32);

    const discovery = swarm.join(topic, { client: true, server: true });

    await discovery.flushed();
    console.log("joined topic:", b4a.toString(topic, "hex"));
    
    if (!peerId) {
      await fs.writeFile(
        "peerId.txt",
        b4a.toString(topic, "hex")
      );
    }

    return b4a.toString(topic, "hex");
  } catch (error) {
    console.error("Error in connectPeers:", error);
    throw error;
  }
};

// API Routes
app.get("/", (req, res) => {
  res.json({ 
    status: "healthy",
    connections: activeConnections.size,
    timestamp: new Date().toISOString()
  });
});

app.get("/api/get-peer-id", async (req, res) => {
  try {
    const peerId = await connectPeers();
    res.json({ id: peerId });
  } catch (error) {
    res.status(500).json({ 
      error: "Failed to generate peer ID",
      details: error.message 
    });
  }
});

app.get("/api/connect-peers", async (req, res) => {
  try {
    const { msg } = req.query;
    const peerId = await fs.readFile("peerId.txt", "utf8");
    
    await connectPeers(peerId, msg);
    
    res.json({ 
      status: "connected",
      msg: currentChat,
      peerId
    });
  } catch (error) {
    res.status(500).json({ 
      error: "Failed to connect peers",
      details: error.message 
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    error: "Internal server error",
    details: err.message
  });
});

const PORT = process.env.SERVER_PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});