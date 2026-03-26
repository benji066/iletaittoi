/*
 * IL ÉTAIT TOI — Backend v3
 * 
 * Fixes:
 * - Image prompts: no zoom, proper framing, full scene visible
 * - Error handling: retry failed pages, never stop mid-generation
 * - Cost optimization: skip image/audio on failure, don't crash
 * 
 * Routes:
 * POST /api/generate-text  → story text (~15s)
 * POST /api/generate-image → 1 image at a time (~12s)
 * POST /api/generate-audio → 1 audio at a time (~5s)
 * GET  /api/health
 */

const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json({ limit: '10mb' }));

const VOICES = {
  female: "21m00Tcm4TlvDq8ikWAM",
  male: "pNInz6obpgDQGcFmaJgB",
};

// ═══ CHARACTER SHEET ═══
function buildCharacterSheet(f) {
  const g = f.sexe === 'fille' ? 'girl' : 'boy';
  let d = `A ${f.age}-year-old ${g} named ${f.prenom}`;
  
  const maps = {
    skin: { 'très claire':'very fair pale skin','claire':'fair light skin','mate':'warm olive tan skin','métisse':'medium warm brown skin','foncée':'rich dark brown skin','très foncée':'deep dark brown skin' },
    hair: { 'blonds':'golden blonde','châtains clairs':'light chestnut brown','châtains':'warm chestnut brown','bruns':'dark chocolate brown','noirs':'jet black','roux':'bright copper red' },
    eyes: { 'bleus':'bright sky blue','verts':'vivid green','marron':'warm chocolate brown','noisette':'golden hazel','noirs':'deep dark brown' }
  };

  if (f.skinColor) d += ` with ${maps.skin[f.skinColor] || f.skinColor}`;
  if (f.hairColor) d += `, ${maps.hair[f.hairColor] || f.hairColor} hair`;
  if (f.hairStyle) d += ` styled as ${f.hairStyle}`;
  if (f.eyeColor) d += `, ${maps.eyes[f.eyeColor] || f.eyeColor} eyes`;
  if (f.height) d += `, approximately ${f.height} tall`;
  if (f.distinctiveFeatures) d += `. Distinctive features: ${f.distinctiveFeatures}`;
  
  d += `. The child has big round expressive eyes, soft round cheeks with rosy tint, small nose, and a warm genuine smile.`;
  d += ` Child body proportions: large head relative to body, short chubby limbs, small hands.`;
  
  return d;
}

// ═══ IMAGE STYLE DIRECTIVE (constant across all pages) ═══
const IMAGE_STYLE = `
MANDATORY ART STYLE:
- Style: Premium children's book illustration, similar to modern Pixar concept art or high-end picture books
- Technique: Soft digital painting with visible gentle brush strokes
- Lighting: Warm, golden, soft cinematic lighting with gentle shadows
- Colors: Rich, saturated but soft palette. Warm tones dominate.
- Mood: Magical, warm, safe, wonder-filled
- Quality: Professional illustration quality, publication-ready

MANDATORY COMPOSITION RULES:
- ALWAYS show the FULL BODY of the child character, head to feet
- NEVER crop or zoom into just the face
- Camera angle: medium shot or wide shot, showing the full scene and environment
- The child should occupy about 25-35% of the frame, NOT more
- Show rich, detailed background environment filling the entire frame
- Use rule of thirds for character placement
- Leave breathing room around the character
- The scene must feel like a full illustration page in a premium children's book

ABSOLUTE PROHIBITIONS:
- NO close-up face shots
- NO cropped bodies
- NO floating heads
- NO empty or plain backgrounds
- NO 3D CGI rendering
- NO anime or manga style
- NO flat vector graphics
- NO photorealistic style
- NO text or words in the image
- NO watermarks
`;

// ═══ STORY PROMPT ═══
function buildSystemPrompt(f) {
  const age = Number(f.age);
  const gFr = f.sexe === 'fille' ? 'fille' : 'garçon';
  
  return `Tu es un auteur primé de littérature jeunesse personnalisée.

MISSION: Créer une histoire de EXACTEMENT 10 pages pour ${f.prenom}, ${gFr} de ${f.age} ans.

INFORMATIONS SUR L'ENFANT:
- Prénom: ${f.prenom}
- Âge: ${f.age} ans (${f.classe || '?'})
- Apparence: peau ${f.skinColor || '?'}, cheveux ${f.hairColor || '?'} ${f.hairStyle || ''}, yeux ${f.eyeColor || '?'}${f.height ? ', ' + f.height : ''}${f.distinctiveFeatures ? ', ' + f.distinctiveFeatures : ''}
- Passions: ${f.passions || 'aventures'}
- Ami/animal/doudou: ${f.bestFriend || 'aucun'}
- Ambiance: ${f.ambiance || 'magique'}
- Apprend: ${f.apprentissage || 'non précisé'}
- Difficultés: ${f.difficultes || 'aucune'}

RÈGLES D'ÉCRITURE:
1. EXACTEMENT 10 pages, numérotées de 1 à 10
2. Le prénom "${f.prenom}" apparaît 2+ fois par page
3. ${age <= 4 ? '40-60 mots par page. Phrases très courtes (5-8 mots). Mots simples.' : age <= 6 ? '60-80 mots par page. Phrases courtes (8-12 mots). Vocabulaire simple.' : '80-110 mots par page. Phrases claires (10-15 mots). Vocabulaire riche mais accessible.'}
4. Chaque page = UNE scène visuelle claire, UNE action principale
5. Alternance: aventure → apprentissage → aventure...
6. Apprentissage INVISIBLE dans l'aventure (jamais scolaire)
7. Confiance en soi renforcée à chaque victoire
8. ${f.difficultes ? 'IMPORTANT: scènes de RÉUSSITE dans: ' + f.difficultes : ''}
9. ${f.bestFriend ? '"' + f.bestFriend + '" = personnage secondaire récurrent' : ''}
10. Ambiance ${f.ambiance || 'magique'}, JAMAIS effrayant

NOTIONS ÉDUCATIVES (${f.age} ans):
${age <= 3 ? 'Couleurs, animaux, formes simples, émotions basiques' : age <= 4 ? 'Lettres (surtout celles du prénom), chiffres 1-10, couleurs, formes' : age <= 5 ? 'Sons des lettres, compter 1-20, comparaisons, séquences' : age <= 6 ? 'Syllabes, additions simples, lecture de mots, temps' : age <= 7 ? 'Lecture phrases, calcul +/- 20, sciences, géographie' : 'Multiplications, conjugaison, sciences, logique'}
${f.apprentissage ? 'FOCUS: ' + f.apprentissage : ''}

POUR CHAQUE PAGE, la "sceneDescription" doit décrire en ANGLAIS une scène complète pour un illustrateur:
- Le DÉCOR complet (lieu, heure du jour, météo, végétation, objets)
- L'ACTION EXACTE du personnage (position debout/assis/courant, geste des bras, direction du regard)
- L'EXPRESSION du visage (joie, surprise, concentration, fierté)
- Les PERSONNAGES SECONDAIRES présents
- Les OBJETS importants dans la scène
- L'ÉCLAIRAGE et l'AMBIANCE VISUELLE
- Si une notion éducative est dans la page: COMMENT elle apparaît visuellement dans le décor (ex: chiffre 3 formé par des branches, lettre A visible dans une arche)
- Minimum 100 mots de description

NE PAS décrire le physique de l'enfant dans sceneDescription (ajouté automatiquement).

FORMAT JSON STRICT (rien d'autre):
{
  "title": "Titre poétique",
  "pages": [
    {
      "pageNumber": 1,
      "type": "intro|aventure|apprentissage|fin",
      "chapterTitle": "Titre court",
      "text": "Texte de la page",
      "sceneDescription": "Description détaillée en anglais 100+ mots"
    }
  ]
}`;
}

// ═══ ROUTE 1: TEXT ═══
app.post('/api/generate-text', async (req, res) => {
  try {
    const f = req.body;
    if (!f.prenom || !f.age) return res.status(400).json({ error: 'Prénom et âge requis' });

    console.log(`\n✦ Histoire pour ${f.prenom}, ${f.age} ans`);
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: buildSystemPrompt(f) },
          { role: 'user', content: `Crée l'histoire de ${f.prenom}. EXACTEMENT 10 pages. JSON uniquement.` }
        ],
        temperature: 0.85,
        max_tokens: 8000,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `OpenAI ${response.status}`);
    }

    const data = await response.json();
    const raw = data.choices[0].message.content;
    
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Réponse non-JSON');
    
    const story = JSON.parse(jsonMatch[0]);
    
    if (!story.pages || story.pages.length < 5) {
      throw new Error(`Seulement ${story.pages?.length || 0} pages générées. Réessayez.`);
    }

    story.characterSheet = buildCharacterSheet(f);
    story.childName = f.prenom;

    console.log(`✅ "${story.title}" — ${story.pages.length} pages`);
    res.json({ story });

  } catch (err) {
    console.error('❌ Texte:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══ ROUTE 2: IMAGE (1 at a time, with retry) ═══
app.post('/api/generate-image', async (req, res) => {
  const { characterSheet, sceneDescription, pageNumber, totalPages, chapterTitle } = req.body;
  
  if (!characterSheet || !sceneDescription) {
    return res.status(400).json({ error: 'Données manquantes', imageUrl: null });
  }

  console.log(`[IMG ${pageNumber}/${totalPages}] ${chapterTitle || '...'}`);

  const prompt = `Premium children's book illustration for a personalized storybook.

THE CHILD CHARACTER (must appear in the scene, full body visible, head to toe):
${characterSheet}

THE SCENE TO ILLUSTRATE:
${sceneDescription}

${IMAGE_STYLE}

${pageNumber === 1 ? 'CRITICAL: This is page 1 — the CHARACTER REFERENCE. The child face, skin tone, hair, outfit must be drawn with extreme precision. All future pages will match this exact design.' : `CONSISTENCY: The child must look EXACTLY like they did on page 1. Same face, same hair, same skin tone, same outfit, same art style. Only expression and pose change.`}`;

  // Try up to 2 times
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const imgRes = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: 'gpt-image-1',
          prompt: prompt,
          size: '1536x1024',
          quality: 'high',
          n: 1,
        }),
      });

      if (!imgRes.ok) {
        const err = await imgRes.json().catch(() => ({}));
        console.log(`  ⚠ Attempt ${attempt}: ${err.error?.message || imgRes.status}`);
        if (attempt === 2) throw new Error(err.error?.message || 'Image failed');
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }

      const imgData = await imgRes.json();
      const url = imgData.data?.[0]?.url;
      const b64 = imgData.data?.[0]?.b64_json;
      const finalUrl = url || (b64 ? `data:image/png;base64,${b64}` : null);

      if (!finalUrl) throw new Error('Pas d\'URL image');

      console.log(`  ✅ Page ${pageNumber} OK`);
      return res.json({ imageUrl: finalUrl });

    } catch (err) {
      if (attempt === 2) {
        console.log(`  ❌ Page ${pageNumber} échouée: ${err.message}`);
        return res.json({ imageUrl: null, error: err.message });
      }
      await new Promise(r => setTimeout(r, 2000));
    }
  }
});

// ═══ ROUTE 3: AUDIO (1 at a time, with retry) ═══
app.post('/api/generate-audio', async (req, res) => {
  const { text, voiceGender, pageNumber } = req.body;
  if (!text) return res.status(400).json({ error: 'Texte requis', audioUrl: null });

  const voiceId = voiceGender === 'male' ? VOICES.male : VOICES.female;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const audioRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'xi-api-key': process.env.ELEVENLABS_API_KEY },
        body: JSON.stringify({
          text: text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: { stability: 0.75, similarity_boost: 0.7, style: 0.4, use_speaker_boost: true },
        }),
      });

      if (!audioRes.ok) {
        const errText = await audioRes.text().catch(() => '');
        console.log(`  ⚠ Audio attempt ${attempt}: ${audioRes.status}`);
        if (attempt === 2) throw new Error(`ElevenLabs ${audioRes.status}`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      const buf = await audioRes.arrayBuffer();
      const b64 = Buffer.from(buf).toString('base64');
      console.log(`  ✅ Audio page ${pageNumber} OK`);
      return res.json({ audioUrl: `data:audio/mpeg;base64,${b64}` });

    } catch (err) {
      if (attempt === 2) {
        console.log(`  ❌ Audio page ${pageNumber}: ${err.message}`);
        return res.json({ audioUrl: null, error: err.message });
      }
      await new Promise(r => setTimeout(r, 1500));
    }
  }
});

// ═══ HEALTH ═══
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', v: 3, openai: !!process.env.OPENAI_API_KEY, elevenlabs: !!process.env.ELEVENLABS_API_KEY });
});

// Keep alive
setInterval(() => { fetch(`http://localhost:${PORT}/api/health`).catch(() => {}); }, 14 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`\n✦ Il était toi v3 — port ${PORT}`);
  console.log(`  OpenAI: ${process.env.OPENAI_API_KEY ? '✅' : '❌'}`);
  console.log(`  ElevenLabs: ${process.env.ELEVENLABS_API_KEY ? '✅' : '❌'}\n`);
});
