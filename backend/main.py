"""
Pflege Voice Reporter – Backend
FastAPI server that uses Claude to extract structured care data from transcribed speech.
"""

import os
import json
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import anthropic

app = FastAPI(title="Pflege Voice Reporter API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

SYSTEM_PROMPT = """Du bist ein spezialisierter KI-Assistent für die Pflegedokumentation.
Deine Aufgabe: Extrahiere aus dem gesprochenen Pflegebericht die folgenden 5 strukturierten Felder.

Antworte AUSSCHLIESSLICH mit einem validen JSON-Objekt (kein Markdown, kein Text drumherum):

{
  "name": "Patientenname oder null",
  "alter": Zahl oder null,
  "pflegegrad": Zahl 1-5 oder null,
  "fluessigkeitsaufnahme": {
    "aufgenommen": true oder false oder null,
    "menge_ml": Zahl in ml oder null,
    "details": "Was getrunken wurde oder null"
  },
  "medikamente": ["Medikament1", "Medikament2"]
}

Regeln:
- name: Vor- und/oder Nachname des Patienten
- alter: Alter in Jahren
- pflegegrad: Deutsche Pflegegrade 1 bis 5. Erkenne "Pflegegrad", "Pflegestufe", "Grad"
- fluessigkeitsaufnahme: Hat die Person getrunken? Erkenne "getrunken", "Wasser", "Tee", "Kaffee", "Saft", "ml", "Liter", "Glas", "Tasse". 1 Glas = ca. 200ml, 1 Tasse = ca. 150ml
- medikamente: Alle genannten Medikamente/Tabletten/Tropfen mit Dosierung wenn genannt
- Setze null wenn die Information NICHT im Text vorkommt
- Gib NUR das JSON zurück, nichts anderes"""


class TranscriptInput(BaseModel):
    transcript: str


@app.get("/api/health")
async def health():
    has_key = bool(os.environ.get("ANTHROPIC_API_KEY"))
    return {"status": "ok", "api_key_configured": has_key}


@app.post("/api/extract")
async def extract_fields(body: TranscriptInput):
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="ANTHROPIC_API_KEY ist nicht gesetzt. Starte das Backend mit: ANTHROPIC_API_KEY=sk-... uvicorn main:app",
        )

    if not body.transcript.strip():
        raise HTTPException(status_code=400, detail="Kein Transkript übermittelt.")

    client = anthropic.Anthropic(api_key=api_key)

    try:
        msg = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=512,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": body.transcript.strip()}],
        )

        raw = msg.content[0].text.strip()

        # Strip markdown code fences if present
        if raw.startswith("```"):
            lines = raw.split("\n")
            raw = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

        data = json.loads(raw)
        return data

    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="KI-Antwort war kein gültiges JSON. Bitte erneut versuchen.")
    except anthropic.APIError as e:
        raise HTTPException(status_code=500, detail=f"Claude API Fehler: {str(e)}")
