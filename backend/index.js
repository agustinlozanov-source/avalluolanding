import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import cors from "cors";

const app = express();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(express.json());
app.use(cors({
  origin: ["https://avalluo.com", "http://localhost:3000"],
  methods: ["POST"],
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
      model: "claude-sonnet-4-20250514",
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

app.get("/health", (_, res) => res.json({ status: "ok", service: "avalluo-api" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Capi corriendo en puerto ${PORT}`));
