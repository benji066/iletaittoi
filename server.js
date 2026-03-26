/*
 * IL ÉTAIT TOI — Backend v2 (Génération Progressive)
 * 
 * Architecture:
 * 1. POST /api/generate-text   → Génère le texte seul (~15s) → retourne l'histoire
 * 2. GET  /api/generate-image   → Génère 1 image à la fois (~10s)
 * 3. GET  /api/generate-audio   → Génère 1 audio à la fois (~5s)
 * 
 * Le frontend appelle d'abord generate-text, ouvre le livre,
 * puis charge images et audio page par page pendant la lecture.
 * 
 * .env: OPENAI_API_KEY, ELEVENLABS_API_KEY, FRONTEND_URL
 */

const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json({ limit: '10mb' }));

// ═══ VOIX ELEVENLABS ═══
const VOICES = {
  female: "21m00Tcm4TlvDq8ikWAM", // Rachel
  male: "pNInz6obpgDQGcFmaJgB",   // Adam
};

// ═══ CHARACTER SHEET BUILDER ═══
function buildCharacterSheet(f) {
  const g = f.sexe === 'fille' ? 'girl' : 'boy';
  let d = `A ${f.age}-year-old ${g}`;
  
  const maps = {
    skin: { 'très claire':'very fair/pale skin','claire':'fair/light skin','mate':'olive/tan skin','métisse':'medium brown/mixed-race skin','foncée':'dark brown skin','très foncée':'deep dark brown skin' },
    hair: { 'blonds':'blonde','châtains clairs':'light brown','châtains':'chestnut brown','bruns':'dark brown','noirs':'jet black','roux':'red/ginger' },
    eyes: { 'bleus':'bright blue','verts':'green','marron':'warm brown','noisette':'hazel','noirs':'very dark brown' }
  };

  if (f.skinColor) d += ` with ${maps.skin[f.skinColor] || f.skinColor}`;
  if (f.hairColor) d += `, ${maps.hair[f.hairColor] || f.hairColor} hair`;
  if (f.hairStyle) d += ` styled in a ${f.hairStyle}`;
  if (f.eyeColor) d += `, ${maps.eyes[f.eyeColor] || f.eyeColor} eyes`;
  if (f.height) d += `, approximately ${f.height} tall (small child proportions, large head relative to body)`;
  if (f.distinctiveFeatures) d += `. Distinctive features: ${f.distinctiveFeatures}`;
  
  d += `. The child has big sparkling expressive eyes, round rosy cheeks with a slight pink tint, and a warm genuine smile showing small baby teeth. Child proportions: larger head, small hands, chubby limbs.`;
  d += ` Art style: premium Pixar/Disney-quality children's book illustration, soft digital painting with visible brush texture, warm cinematic golden-hour lighting, rich saturated colors, depth of field background blur. Emotional and heartwarming. NOT 3D CGI render, NOT anime/manga, NOT flat vector, NOT clipart, NOT photorealistic.`;
  
  return d;
}

// ═══ STORY GENERATION PROMPT ═══
function buildSystemPrompt(f) {
  const age = Number(f.age);
  const gFr = f.sexe === 'fille' ? 'fille' : 'garçon';
  
  return `Tu es un auteur primé de littérature jeunesse, spécialisé dans les histoires personnalisées qui renforcent la confiance en soi des enfants. Chaque histoire que tu écris est une œuvre unique, jamais un modèle recyclé.

═══ MISSION ═══
Créer une histoire captivante de 10 pages pour ${f.prenom}, ${gFr} de ${f.age} ans, où cet enfant est le HÉROS ABSOLU de l'aventure.

═══ INFORMATIONS SUR L'ENFANT ═══
- Prénom: ${f.prenom}
- Âge: ${f.age} ans
- Sexe: ${f.sexe || 'non précisé'}
- Classe: ${f.classe || 'non précisée'}
- Apparence: peau ${f.skinColor || '?'}, cheveux ${f.hairColor || '?'} ${f.hairStyle || ''}, yeux ${f.eyeColor || '?'}${f.height ? ', taille ' + f.height : ''}${f.distinctiveFeatures ? ', ' + f.distinctiveFeatures : ''}
- Passions: ${f.passions || 'non précisées'}
- Meilleur ami/animal/doudou: ${f.bestFriend || 'aucun'}
- Ambiance souhaitée: ${f.ambiance || 'magique'}
- Apprend en ce moment: ${f.apprentissage || 'non précisé'}
- Difficultés: ${f.difficultes || 'aucune mentionnée'}

═══ RÈGLES NARRATIVES STRICTES ═══
1. Le prénom "${f.prenom}" doit apparaître au minimum 2 fois par page
2. Décrire physiquement l'enfant au moins 3 fois dans l'histoire (ses cheveux, ses yeux, sa taille, ses traits)
3. Les passions de l'enfant (${f.passions || 'aventures'}) doivent être des éléments MOTEURS de l'intrigue, pas juste mentionnées
4. ${f.bestFriend ? `"${f.bestFriend}" est un personnage secondaire important, présent dans au moins 5 pages sur 10` : "L'enfant peut rencontrer un compagnon d'aventure en cours de route"}
5. Structure ALTERNÉE obligatoire: intro → aventure → apprentissage → aventure → apprentissage → aventure → apprentissage → aventure climax → apprentissage final → conclusion
6. L'apprentissage doit être INVISIBLE: l'enfant apprend en résolvant des énigmes, en aidant des personnages, en vivant l'aventure — JAMAIS en mode leçon
7. Chaque page doit contenir un moment qui RENFORCE LA CONFIANCE EN SOI: les personnages félicitent l'enfant, reconnaissent sa valeur, son intelligence, son courage
8. ${f.difficultes ? `CRUCIAL: Au moins 2 scènes où l'enfant RÉUSSIT SPÉCIFIQUEMENT dans le domaine où il a des difficultés (${f.difficultes}). Montrer qu'il en est capable.` : ''}
9. Longueur par page: ${age <= 3 ? '50-70 mots (phrases très courtes)' : age <= 4 ? '60-90 mots' : age <= 5 ? '80-110 mots' : age <= 6 ? '90-130 mots' : age <= 7 ? '110-150 mots' : '130-170 mots'}
10. Vocabulaire strictement adapté à ${f.age} ans
11. Le ton doit être ${f.ambiance || 'magique'} mais JAMAIS effrayant, JAMAIS triste, JAMAIS violent
12. La fin doit être profondément ÉMOUVANTE pour les parents qui lisent à voix haute — un moment où l'enfant montre qu'il a grandi

═══ NOTIONS ÉDUCATIVES À INTÉGRER (âge: ${f.age} ans) ═══
${age <= 3 ? "- Reconnaissance des couleurs (rouge, bleu, jaune, vert)\n- Noms d'animaux courants\n- Formes simples (rond, carré, triangle)\n- Émotions basiques (content, triste, surpris)\n- Mots du quotidien\nMÉTHODE: l'enfant pointe, nomme, associe dans l'aventure"
  : age <= 4 ? "- Reconnaissance des lettres (surtout celles du prénom de l'enfant)\n- Chiffres de 1 à 10\n- Couleurs et formes\n- Catégorisation (animaux/pas animaux, grand/petit)\nMÉTHODE: l'enfant identifie des lettres, compte des objets dans la scène"
  : age <= 5 ? "- Sons des lettres (phonologie: le son au début des mots)\n- Compter jusqu'à 20\n- Comparaisons (plus grand/plus petit, plus lourd/plus léger)\n- Séquences logiques\nMÉTHODE: l'enfant associe lettre→son→mot, résout des suites logiques"
  : age <= 6 ? "- Syllabes et début de lecture\n- Additions simples (1+2=3, 3+4=7)\n- Notion du temps (hier/aujourd'hui/demain, les saisons)\n- Écriture de mots simples\nMÉTHODE: l'enfant déchiffre des indices écrits, calcule pour avancer dans l'aventure"
  : age <= 7 ? "- Lecture de phrases complètes\n- Additions et soustractions jusqu'à 20\n- Géographie simple (continents, pays)\n- Sciences naturelles (cycle de l'eau, les planètes)\nMÉTHODE: l'enfant lit des messages secrets, résout des problèmes mathématiques"
  : "- Multiplications (tables de 2 à 5)\n- Conjugaison (présent, passé composé, futur)\n- Sciences (système solaire, corps humain, écologie)\n- Problèmes de logique et déduction\nMÉTHODE: l'enfant utilise raisonnement et connaissances pour résoudre des énigmes complexes"}
${f.apprentissage ? `\nNOTIONS SPÉCIFIQUES À INTÉGRER (l'enfant travaille ça en ce moment): ${f.apprentissage}` : ''}
${f.difficultes ? `\nDIFFICULTÉS À TRANSFORMER EN VICTOIRES: ${f.difficultes}. Créer des scènes où l'enfant RÉUSSIT exactement dans ces domaines.` : ''}

═══ FORMAT DE SORTIE — JSON STRICT ═══
Réponds UNIQUEMENT avec du JSON valide, sans texte avant ni après, sans backticks markdown.

{
  "title": "Titre magique et poétique de l'histoire",
  "pages": [
    {
      "pageNumber": 1,
      "type": "intro",
      "chapterTitle": "Titre court et évocateur du chapitre",
      "text": "Texte complet de la page. Doit mentionner le prénom, être adapté à l'âge, et contenir un élément qui renforce la confiance en soi.",
      "sceneDescription": "Description TRÈS DÉTAILLÉE en ANGLAIS de la scène pour générer une illustration (150+ mots). Décrire précisément: 1) Le décor complet (lieu, heure, lumière, météo, couleurs dominantes) 2) L'action exacte de l'enfant (position du corps, geste des mains, direction du regard) 3) L'expression faciale (joie, surprise, détermination, fierté) 4) Tous les objets et personnages secondaires présents 5) L'atmosphère et l'éclairage cinématique. NE PAS décrire le physique de l'enfant (ajouté automatiquement). Être assez précis pour qu'un illustrateur puisse dessiner la scène sans ambiguïté."
    }
  ]
}`;
}

// ═══ ROUTE 1: GÉNÉRER LE TEXTE (rapide, ~15s) ═══
app.post('/api/generate-text', async (req, res) => {
  try {
    const f = req.body;
    if (!f.prenom || !f.age) return res.status(400).json({ error: 'Prénom et âge requis' });

    console.log(`\n✦ Nouvelle histoire pour ${f.prenom}, ${f.age} ans`);
    console.log(`  Passions: ${f.passions || '?'}`);
    console.log(`  Apparence: peau ${f.skinColor || '?'}, cheveux ${f.hairColor || '?'} ${f.hairStyle || ''}`);
    console.log(`[1] Génération du texte...`);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: buildSystemPrompt(f) },
          { role: 'user', content: `Crée l'histoire personnalisée de ${f.prenom}, ${f.age} ans. Réponds UNIQUEMENT en JSON valide.` }
        ],
        temperature: 0.88,
        max_tokens: 7000,
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || `OpenAI erreur ${response.status}`);
    }

    const data = await response.json();
    const rawText = data.choices[0].message.content;
    
    // Parse JSON robuste
    let story;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Pas de JSON trouvé');
      story = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.error('Erreur parsing JSON:', parseErr.message);
      console.error('Texte reçu:', rawText.substring(0, 500));
      throw new Error('Le texte généré n\'est pas du JSON valide. Réessayez.');
    }

    // Ajouter le character sheet pour les appels image
    story.characterSheet = buildCharacterSheet(f);
    story.childName = f.prenom;

    console.log(`[1] ✅ Texte généré: "${story.title}" (${story.pages.length} pages)`);
    res.json({ story });

  } catch (err) {
    console.error('❌ Erreur texte:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══ ROUTE 2: GÉNÉRER UNE IMAGE (appelée page par page) ═══
app.post('/api/generate-image', async (req, res) => {
  try {
    const { characterSheet, sceneDescription, pageNumber, totalPages, chapterTitle } = req.body;
    
    if (!characterSheet || !sceneDescription) {
      return res.status(400).json({ error: 'characterSheet et sceneDescription requis' });
    }

    console.log(`[IMG] Page ${pageNumber}/${totalPages}: ${chapterTitle || '...'}`);

    const isFirstPage = pageNumber === 1;
    
    let prompt;
    if (isFirstPage) {
      prompt = `Premium children's book illustration — OPENING PAGE and CHARACTER REFERENCE.

THE HERO (draw this child PRECISELY as described, this is the reference for all other pages):
${characterSheet}

SCENE:
${sceneDescription}

COMPOSITION: The child takes up approximately 35-40% of the frame. Position them slightly off-center for dynamic composition. Use rule of thirds. Rich, detailed background with depth. Foreground elements for depth.

LIGHTING: Warm, golden, cinematic. Soft volumetric light rays. Gentle lens flare optional.

CRITICAL: This illustration establishes the CHARACTER DESIGN that must remain identical across all 10 pages. Pay extreme attention to the child's exact skin tone, hair color, hair style, eye color, facial features, and clothing.`;
    } else {
      prompt = `Premium children's book illustration — Page ${pageNumber} of ${totalPages}.

THE HERO (must be VISUALLY IDENTICAL to page 1 — same face shape, same skin tone, same hair color and style, same eye color, same clothing):
${characterSheet}

SCENE:
${sceneDescription}

CONSISTENCY RULES:
- The child's appearance must match EXACTLY the character established on page 1
- Same art style, same level of detail, same color palette feel
- Same proportions, same facial features, same clothing
- Only the expression, pose, and scene change — the CHARACTER DESIGN stays identical

COMPOSITION: Cinematic framing. The child is clearly visible and recognizable. Rich detailed environment. Warm, magical lighting.`;
    }

    const imgResponse = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt: prompt,
        size: '1536x1024',
        quality: 'high',
        n: 1,
      }),
    });

    if (!imgResponse.ok) {
      const err = await imgResponse.json();
      throw new Error(err.error?.message || `Erreur image ${imgResponse.status}`);
    }

    const imgData = await imgResponse.json();
    const imageUrl = imgData.data?.[0]?.url || null;
    const imageB64 = imgData.data?.[0]?.b64_json || null;
    
    const finalUrl = imageUrl || (imageB64 ? `data:image/png;base64,${imageB64}` : null);

    console.log(`[IMG] ✅ Page ${pageNumber} générée`);
    res.json({ imageUrl: finalUrl });

  } catch (err) {
    console.error(`❌ Erreur image:`, err.message);
    res.status(500).json({ error: err.message, imageUrl: null });
  }
});

// ═══ ROUTE 3: GÉNÉRER UN AUDIO (appelée page par page) ═══
app.post('/api/generate-audio', async (req, res) => {
  try {
    const { text, voiceGender, pageNumber } = req.body;
    
    if (!text) return res.status(400).json({ error: 'text requis' });

    const voiceId = voiceGender === 'male' ? VOICES.male : VOICES.female;

    console.log(`[AUD] Page ${pageNumber}: ${text.substring(0, 40)}...`);

    const audioResponse = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
      },
      body: JSON.stringify({
        text: text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.78,
          similarity_boost: 0.72,
          style: 0.35,
          use_speaker_boost: true,
        },
      }),
    });

    if (!audioResponse.ok) {
      const errText = await audioResponse.text();
      throw new Error(`ElevenLabs erreur ${audioResponse.status}: ${errText.substring(0, 200)}`);
    }

    const audioBuffer = await audioResponse.arrayBuffer();
    const base64Audio = Buffer.from(audioBuffer).toString('base64');

    console.log(`[AUD] ✅ Page ${pageNumber} générée`);
    res.json({ audioUrl: `data:audio/mpeg;base64,${base64Audio}` });

  } catch (err) {
    console.error(`❌ Erreur audio:`, err.message);
    res.status(500).json({ error: err.message, audioUrl: null });
  }
});

// ═══ HEALTH CHECK ═══
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Il était toi v2',
    openai: !!process.env.OPENAI_API_KEY,
    elevenlabs: !!process.env.ELEVENLABS_API_KEY,
    timestamp: new Date().toISOString(),
  });
});

// ═══ KEEP ALIVE (empêche Render de s'endormir) ═══
setInterval(() => {
  fetch(`http://localhost:${PORT}/api/health`).catch(() => {});
}, 14 * 60 * 1000); // Ping toutes les 14 minutes

// ═══ START ═══
app.listen(PORT, () => {
  console.log(`\n✦ ═══════════════════════════════════════`);
  console.log(`✦  IL ÉTAIT TOI — Backend v2`);
  console.log(`✦  Port: ${PORT}`);
  console.log(`✦  OpenAI:     ${process.env.OPENAI_API_KEY ? '✅ connecté' : '❌ MANQUANT'}`);
  console.log(`✦  ElevenLabs: ${process.env.ELEVENLABS_API_KEY ? '✅ connecté' : '❌ MANQUANT'}`);
  console.log(`✦  Mode: Production`);
  console.log(`✦ ═══════════════════════════════════════\n`);
});
