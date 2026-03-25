/*
 * IL ÉTAIT TOI — Backend
 * 2 APIs: OpenAI (texte + images) + ElevenLabs (audio)
 * 
 * .env:
 * OPENAI_API_KEY=votre_cle
 * ELEVENLABS_API_KEY=votre_cle
 * FRONTEND_URL=https://iletaittoi.shop
 */

const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json({ limit: '50mb' }));

const VOICES = {
  female: { id: "21m00Tcm4TlvDq8ikWAM" },
  male: { id: "pNInz6obpgDQGcFmaJgB" },
};

function buildCharacterSheet(f) {
  const g = f.sexe === 'fille' ? 'girl' : 'boy';
  let d = `A ${f.age}-year-old ${g}`;
  const sk = {'très claire':'very fair','claire':'fair','mate':'olive/tan','métisse':'medium brown','foncée':'dark brown','très foncée':'deep brown'};
  const hr = {'blonds':'blonde','châtains clairs':'light brown','châtains':'brown','bruns':'dark brown','noirs':'black','roux':'red/ginger'};
  const ey = {'bleus':'blue','verts':'green','marron':'brown','noisette':'hazel','noirs':'dark brown'};
  if(f.skinColor)d+=` with ${sk[f.skinColor]||f.skinColor} skin`;
  if(f.hairColor)d+=`, ${hr[f.hairColor]||f.hairColor} hair`;
  if(f.hairStyle)d+=` in a ${f.hairStyle} style`;
  if(f.eyeColor)d+=`, ${ey[f.eyeColor]||f.eyeColor} eyes`;
  if(f.height)d+=`, ${f.height} tall`;
  if(f.distinctiveFeatures)d+=`. Features: ${f.distinctiveFeatures}`;
  d+=`. Big expressive eyes, round rosy cheeks, warm smile. Pixar-quality children's book illustration, soft digital painting, warm cinematic lighting. NOT 3D, NOT manga.`;
  return d;
}

function buildPrompt(f) {
  const a = Number(f.age);
  return `Tu es un auteur primé de littérature jeunesse.

MISSION: Histoire de 10 pages où ${f.prenom} est le HÉROS.

RÈGLES:
- Prénom "${f.prenom}" min 2x par page
- Description physique 3+ fois (cheveux ${f.hairColor||''} ${f.hairStyle||''}, peau ${f.skinColor||''}, yeux ${f.eyeColor||''}${f.height?', '+f.height:''})
- Passions (${f.passions||'aventures'}) = moteurs de l'intrigue
${f.bestFriend?`- "${f.bestFriend}" = personnage secondaire (5+ pages)`:''}
- Alternance aventure/apprentissage
- Apprentissage INVISIBLE
- Confiance en soi renforcée
${f.difficultes?`- CRUCIAL: scènes de RÉUSSITE dans: ${f.difficultes}`:''}
- ${a<=4?'60-90':a<=6?'90-130':'120-160'} mots/page
- Vocabulaire ${f.age} ans, ambiance ${f.ambiance||'magique'}

ÉDUCATION (${f.age} ans):
${a<=3?'Couleurs, animaux, formes':a<=4?'Lettres, chiffres 1-10, couleurs':a<=5?'Sons des lettres, compter 1-20':a<=6?'Syllabes, additions, lecture':a<=7?'Lecture, +/- jusqu\'à 20, sciences':'Multiplications, conjugaison, logique'}
${f.apprentissage?'NOTIONS: '+f.apprentissage:''}

JSON UNIQUEMENT:
{"title":"...","pages":[{"pageNumber":1,"type":"aventure|apprentissage","chapterTitle":"...","text":"...","sceneDescription":"Description EN ANGLAIS 100+ mots de la scène pour illustration. Décor, action, expressions, objets, éclairage. PAS le physique du personnage."}]}`;
}

app.post('/api/generate', async (req, res) => {
  try {
    const f = req.body;
    if(!f.prenom||!f.age) return res.status(400).json({error:'Prénom et âge requis'});
    const cs = buildCharacterSheet(f);

    // 1. TEXTE
    console.log(`[1/3] Texte ${f.prenom}...`);
    const tr = await fetch('https://api.openai.com/v1/chat/completions',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.OPENAI_API_KEY}`},
      body:JSON.stringify({model:'gpt-4o',messages:[{role:'system',content:buildPrompt(f)},{role:'user',content:`Histoire de ${f.prenom}, ${f.age} ans. JSON uniquement.`}],temperature:0.85,max_tokens:6000})
    });
    const td = await tr.json();
    if(!tr.ok) throw new Error(td.error?.message||'Erreur OpenAI');
    const story = JSON.parse(td.choices[0].message.content.match(/\{[\s\S]*\}/)[0]);

    // 2. IMAGES
    console.log(`[2/3] Images...`);
    for(let i=0;i<story.pages.length;i++){
      const p=story.pages[i];
      console.log(`  img ${i+1}/${story.pages.length}`);
      try{
        const ir=await fetch('https://api.openai.com/v1/images/generations',{
          method:'POST',
          headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.OPENAI_API_KEY}`},
          body:JSON.stringify({model:'gpt-image-1',prompt:`Children's book ${i===0?'cover':'page '+(i+1)}. HERO: ${cs}. SCENE: ${p.sceneDescription}. ${i>0?'IDENTICAL character to cover.':'CHARACTER REFERENCE image.'}`,size:'1536x1024',quality:'high',n:1})
        });
        const id=await ir.json();
        p.imageUrl=id.data?.[0]?.url||`data:image/png;base64,${id.data?.[0]?.b64_json}`||null;
      }catch(e){console.log(`  ❌ img ${i+1}:`,e.message);p.imageUrl=null}
      await new Promise(r=>setTimeout(r,1500));
    }

    // 3. AUDIO
    console.log(`[3/3] Audio...`);
    const vid=f.voiceGender==='male'?VOICES.male.id:VOICES.female.id;
    for(let i=0;i<story.pages.length;i++){
      const p=story.pages[i];
      try{
        const ar=await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vid}`,{
          method:'POST',
          headers:{'Content-Type':'application/json','xi-api-key':process.env.ELEVENLABS_API_KEY},
          body:JSON.stringify({text:p.text,model_id:'eleven_multilingual_v2',voice_settings:{stability:0.78,similarity_boost:0.72,style:0.3,use_speaker_boost:true}})
        });
        if(ar.ok){const buf=await ar.arrayBuffer();p.audioUrl=`data:audio/mpeg;base64,${Buffer.from(buf).toString('base64')}`}
        else p.audioUrl=null;
      }catch(e){p.audioUrl=null}
      await new Promise(r=>setTimeout(r,500));
    }

    console.log(`✅ ${f.prenom} terminé!`);
    res.json({story});
  }catch(err){
    console.error('❌',err.message);
    res.status(500).json({error:err.message});
  }
});

app.get('/api/health',(req,res)=>{
  res.json({status:'ok',openai:!!process.env.OPENAI_API_KEY,elevenlabs:!!process.env.ELEVENLABS_API_KEY});
});

app.listen(PORT,()=>{
  console.log(`\n✦ Il était toi — port ${PORT}`);
  console.log(`  OpenAI: ${process.env.OPENAI_API_KEY?'✅':'❌'}`);
  console.log(`  ElevenLabs: ${process.env.ELEVENLABS_API_KEY?'✅':'❌'}\n`);
});
