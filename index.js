const express = require("express");
const app = express();
const dotEnv = require("dotenv");
const bodyParser = require("body-parser");
const cors = require("cors");
const Hyperswarm = require("hyperswarm");
const goodbye = require("graceful-goodbye");
const crypto = require("hypercore-crypto");
const b4a = require("b4a");
const fs = require("fs/promises");

dotEnv.config();

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

// Message storage
const messageStore = {
  messages: [],
  async addMessage(message) {
    this.messages.push({
      ...message,
      id: crypto.randomBytes(16).toString('hex'),
      timestamp: new Date().toISOString()
    });
    
    // Limit messages to last 100
    if (this.messages.length > 100) {
      this.messages.shift();
    }

    // Persist messages to file
    try {
      await fs.writeFile(
        'messages.json', 
        JSON.stringify(this.messages, null, 2)
      );
    } catch (error) {
      console.error('Failed to persist messages:', error);
    }
  },
  async loadMessages() {
    try {
      const data = await fs.readFile('messages.json', 'utf8');
      this.messages = JSON.parse(data);
    } catch (error) {
      console.error('No existing messages found');
      this.messages = [];
    }
  }
};

// Initialize message store on startup
messageStore.loadMessages();

const connectPeers = async (peerId, msg) => {
  const swarm = new Hyperswarm();
  goodbye(() => swarm.destroy());

  const conns = [];
  swarm.on("connection", (conn) => {
    const name = b4a.toString(conn.remotePublicKey, "hex");
    console.log("* got a connection from:", name, "*");
    
    conns.push(conn);
    conn.once("close", () => conns.splice(conns.indexOf(conn), 1));
    
    conn.on("data", async (data) => {
      const message = {
        text: data.toString(),
        sender: name,
        peerId: name
      };
      
      await messageStore.addMessage(message);
    });
  });

  const topic = peerId 
    ? b4a.from(peerId, "hex")
    : crypto.randomBytes(32);

  const discovery = swarm.join(topic, { client: true, server: true });
  await discovery.flushed();

  if (msg) {
    for (const conn of conns) {
      conn.write(msg);
    }
  }

  return b4a.toString(topic, "hex");
};

// API Endpoints
app.get("/", (req, res) => {
  res.json({ message: "P2P Chat Backend Operational!" });
});

app.get("/api/get-peer-id", async (req, res) => {
  try {
    const peerId = await connectPeers();
    res.json({ id: peerId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/connect-peers", async (req, res) => {
  try {
    const { peerId, msg } = req.query;
    await connectPeers(peerId, msg);
    res.json({ 
      status: "connected",
      messages: messageStore.messages 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// New message-related endpoints
app.post("/api/send-message", async (req, res) => {
  try {
    const { text, sender, peerId } = req.body;
    
    const message = {
      text,
      sender,
      peerId
    };

    await messageStore.addMessage(message);
    res.json({ 
      status: "message sent", 
      message: message 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/get-messages", async (req, res) => {
  try {
    const { peerId } = req.query;
    
    // Optional filtering by peerId
    const filteredMessages = peerId
      ? messageStore.messages.filter(m => m.peerId === peerId)
      : messageStore.messages;

    res.json({ 
      messages: filteredMessages,
      total: filteredMessages.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.SERVER_PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});