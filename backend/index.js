import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import cors from "cors";
import admin from "firebase-admin";

// ── Firebase Admin init ──
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  });
}
const db = admin.firestore();
const { Timestamp } = admin.firestore;

const app = express();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(express.json());
app.use(cors({
  origin: function(origin, callback){
    const allowed = [
      'https://avalluo.com',
      'https://www.avalluo.com',
      'http://localhost:3000',
      'http://localhost:5500',
      'http://127.0.0.1:5500',
    ];
    // Permitir cualquier subdominio de netlify.app
    if(!origin || allowed.includes(origin) || /\.netlify\.app$/.test(origin)){
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['POST', 'GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));

const SYSTEM_PROMPT = `Eres Capi, el asistente virtual de avalluo. 
avalluo es una plataforma nacional de avalúos con tecnología propia, base de datos exclusiva y metodología propia bajo norma NMX-Z-013. 
Tenemos valuadores certificados en los 32 estados de México, especializados en maquinaria industrial, embarcaciones y aeronaves.

Tu rol:
- Responder preguntas generales sobre avalúos y sobre avalluo
- Explicar el proceso de manera simple y clara
- Generar confianza y orientar al usuario a contactar por WhatsApp
- Ser conversacional, cálido y profesional — nunca robótico
- Nunca inventar precios, tiempos exactos de entrega ni compromisos específicos
- Si te preguntan algo técnico muy específico, di que un especialista lo puede resolver por WhatsApp

Siempre que el usuario muestre interés real en un avalúo, termina tu respuesta invitándolo a escribir por WhatsApp al número de avalluo donde un especialista lo va a atender de inmediato.

Responde siempre en español. Máximo 3 párrafos cortos por respuesta.`;

app.post("/chat", async (req, res) => {
  const { messages } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "messages requerido" });
  }

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages,
    });

    res.json({ reply: response.content[0].text });
  } catch (error) {
    console.error("Error Anthropic:", error);
    res.status(500).json({ error: "Error al procesar tu mensaje" });
  }
});

// ── POST /web-leads ── Recibe leads desde landing pages externas
app.post("/web-leads", async (req, res) => {
  try {
    const {
      nombre, empresa, telefono, correo,
      tipo_activo, proposito, urgencia,
      valor_estimado, estado, descripcion,
      landingPageId = 'activos-industriales',
      orgId = 'uZMwlNxde6TnqGo0HWiD'
    } = req.body;

    if (!nombre || !telefono || !correo) {
      return res.status(400).json({ error: 'nombre, telefono y correo son requeridos' });
    }

    // Calcular score del lead
    let score = 0;
    if (empresa) score += 20;
    if (proposito === 'Proceso judicial') score += 30;
    if (proposito === 'Siniestro') score += 30;
    if (proposito === 'Liquidación o concurso mercantil') score += 30;
    if (urgencia === 'esta_semana') score += 40;
    if (urgencia === 'este_mes') score += 20;
    if (valor_estimado === 'Más de $50M MXN') score += 30;
    if (valor_estimado === '$5M a $50M MXN') score += 20;
    if (valor_estimado === '$500K a $5M MXN') score += 10;

    const orgRef = db.collection('organizations').doc(orgId);

    // Buscar si ya existe lead con ese correo
    const existing = await orgRef.collection('leads')
      .where('email', '==', correo)
      .limit(1).get();

    if (!existing.empty) {
      const leadRef = existing.docs[0].ref;
      await leadRef.update({
        updatedAt: Timestamp.now(),
        score: Math.max(existing.docs[0].data().score || 0, score),
        lastMessage: descripcion || `Nuevo contacto desde ${landingPageId}`,
        lastMessageAt: Timestamp.now(),
        hasUnread: true,
      });
      return res.json({ success: true, leadId: leadRef.id, action: 'updated' });
    }

    // Obtener primer stage del pipeline
    const stages = await orgRef.collection('stages')
      .orderBy('order', 'asc').limit(1).get();
    const stageId = stages.empty ? null : stages.docs[0].id;

    // Crear nuevo lead
    const leadData = {
      name: nombre,
      phone: telefono,
      email: correo,
      company: empresa || '',
      source: 'web',
      landingPageId,
      stageId,
      score,
      assignedTo: null,
      channelIds: {},
      lastMessage: descripcion || `Solicitud desde ${landingPageId}`,
      lastMessageAt: Timestamp.now(),
      lastMessageChannel: 'web',
      hasUnread: true,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      notes: descripcion || '',
      metadata: {
        tipo_activo: tipo_activo || '',
        proposito: proposito || '',
        urgencia: urgencia || '',
        valor_estimado: valor_estimado || '',
        estado_activo: estado || '',
      }
    };

    const leadRef = await orgRef.collection('leads').add(leadData);

    // Crear mensaje inicial en conversación
    await leadRef.collection('conversations').add({
      text: descripcion || `Solicitud de avalúo desde ${landingPageId}`,
      channel: 'web',
      role: 'user',
      channelMsgId: null,
      read: false,
      createdAt: Timestamp.now(),
    });

    return res.json({ success: true, leadId: leadRef.id, action: 'created', score });

  } catch (error) {
    console.error('Error creando lead web:', error);
    return res.status(500).json({ error: 'Error interno al procesar el lead' });
  }
});

app.get("/health", (_, res) => res.json({ status: "ok", service: "avalluo-api" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Capi corriendo en puerto ${PORT}`));
