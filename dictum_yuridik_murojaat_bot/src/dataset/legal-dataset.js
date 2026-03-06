/**
 * Golden Legal Dataset System
 *
 * Provides high-quality legal examples for RAG-enhanced AI analysis.
 * Uses PostgreSQL with pg_trgm trigram similarity for fuzzy text matching.
 */

const { pool } = require('../database/db');

// ========== DATABASE SETUP ==========

async function initLegalDataset() {
  try {
    // Enable pg_trgm extension for trigram similarity search
    await pool.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

    // Create the golden legal dataset table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS legal_training_dataset (
        id SERIAL PRIMARY KEY,
        question TEXT NOT NULL,
        legal_field VARCHAR(100) NOT NULL,
        legal_issue TEXT NOT NULL,
        applicable_law TEXT NOT NULL,
        court_practice TEXT,
        analysis TEXT NOT NULL,
        correct_answer TEXT NOT NULL,
        source VARCHAR(255) DEFAULT 'manual',
        keywords TEXT[] DEFAULT '{}',
        quality_score SMALLINT DEFAULT 5 CHECK (quality_score BETWEEN 1 AND 10),
        times_used INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // GIN indexes for full-text search + trigram similarity
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_legal_dataset_question_trgm ON legal_training_dataset USING GIN (question gin_trgm_ops)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_legal_dataset_legal_issue_trgm ON legal_training_dataset USING GIN (legal_issue gin_trgm_ops)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_legal_dataset_field ON legal_training_dataset(legal_field)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_legal_dataset_keywords ON legal_training_dataset USING GIN (keywords)`);

    // Seed initial dataset if table is empty
    const count = await pool.query(`SELECT COUNT(*) FROM legal_training_dataset`);
    if (parseInt(count.rows[0].count) === 0) {
      await seedInitialDataset();
    }

    console.log('[LEGAL DATASET] Initialized successfully');
  } catch (err) {
    console.error('[LEGAL DATASET] Init error:', err.message);
  }
}

// ========== RETRIEVE SIMILAR EXAMPLES ==========

/**
 * Search the golden dataset for 3-5 most similar legal examples.
 * Uses combined scoring: trigram similarity + keyword overlap + field match.
 */
async function retrieveSimilarExamples(userQuestion, legalField = null) {
  try {
    const params = [userQuestion];
    let fieldFilter = '';

    if (legalField && legalField !== 'Boshqa') {
      fieldFilter = `AND (legal_field ILIKE $2 OR legal_field = 'Umumiy')`;
      params.push(`%${legalField}%`);
    }

    // Combined similarity: question trigram + legal_issue trigram + keyword overlap
    const result = await pool.query(`
      SELECT
        id, question, legal_field, legal_issue, applicable_law,
        court_practice, analysis, correct_answer, source, keywords,
        (
          COALESCE(similarity(question, $1), 0) * 0.4 +
          COALESCE(similarity(legal_issue, $1), 0) * 0.3 +
          COALESCE(
            (SELECT COUNT(*)::float / GREATEST(array_length(keywords, 1), 1)
             FROM unnest(keywords) k
             WHERE $1 ILIKE '%' || k || '%'), 0
          ) * 0.3
        ) AS relevance_score
      FROM legal_training_dataset
      WHERE 1=1 ${fieldFilter}
      ORDER BY relevance_score DESC, quality_score DESC, times_used DESC
      LIMIT 5
    `, params);

    // Filter out very low relevance (below 0.05 threshold)
    const examples = result.rows.filter(r => r.relevance_score > 0.05);

    // Increment usage counter for returned examples
    if (examples.length > 0) {
      const ids = examples.map(e => e.id);
      await pool.query(
        `UPDATE legal_training_dataset SET times_used = times_used + 1 WHERE id = ANY($1)`,
        [ids]
      );
    }

    console.log(`[LEGAL DATASET] Found ${examples.length} similar examples (top score: ${examples[0]?.relevance_score?.toFixed(3) || 0})`);
    return examples;
  } catch (err) {
    console.error('[LEGAL DATASET] Search error:', err.message);
    return [];
  }
}

/**
 * Format retrieved examples into a prompt injection block.
 */
function formatExamplesForPrompt(examples) {
  if (!examples || examples.length === 0) return '';

  const formatted = examples.map((ex, i) => `
Namuna ${i + 1} (${ex.legal_field}):
Savol: ${ex.question}
Huquqiy masala: ${ex.legal_issue}
Qo'llaniladigan qonun: ${ex.applicable_law}
${ex.court_practice ? `Sud amaliyoti: ${ex.court_practice}` : ''}
Tahlil: ${ex.analysis}
To'g'ri javob: ${ex.correct_answer}
Manba: ${ex.source}`).join('\n---');

  return `
O'XSHASH HUQUQIY NAMUNALAR (Golden Dataset):
Quyidagi namunalar sizga to'g'ri huquqiy mushohada yuritishda yordam beradi.
Bu namunalar tekshirilgan va tasdiqlangan huquqiy tahlillardir.
Ulardan o'rganib, shu usulda javob bering.
${formatted}

MUHIM: Yuqoridagi namunalardan foydalanib, O'XSHASH tarzda javob bering.
Ammo har bir javob hozirgi murojaatga MOSLASHTIRILGAN bo'lishi shart.
Namunalardagi modda raqamlarini ko'r-ko'rona nusxalamang — har birini tekshiring.`;
}

// ========== CRUD OPERATIONS ==========

async function addExample(data) {
  const { question, legal_field, legal_issue, applicable_law, court_practice, analysis, correct_answer, source, keywords } = data;
  const result = await pool.query(
    `INSERT INTO legal_training_dataset
     (question, legal_field, legal_issue, applicable_law, court_practice, analysis, correct_answer, source, keywords)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [question, legal_field, legal_issue, applicable_law, court_practice || '', analysis, correct_answer, source || 'manual', keywords || []]
  );
  return result.rows[0];
}

async function updateExample(id, data) {
  const fields = [];
  const values = [];
  let paramIdx = 1;

  for (const [key, val] of Object.entries(data)) {
    if (['question', 'legal_field', 'legal_issue', 'applicable_law', 'court_practice', 'analysis', 'correct_answer', 'source', 'keywords', 'quality_score'].includes(key)) {
      fields.push(`${key} = $${paramIdx}`);
      values.push(val);
      paramIdx++;
    }
  }

  if (fields.length === 0) return null;
  fields.push(`updated_at = NOW()`);
  values.push(id);

  const result = await pool.query(
    `UPDATE legal_training_dataset SET ${fields.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
    values
  );
  return result.rows[0];
}

async function deleteExample(id) {
  await pool.query(`DELETE FROM legal_training_dataset WHERE id = $1`, [id]);
}

async function getAllExamples(limit = 50, offset = 0) {
  const result = await pool.query(
    `SELECT * FROM legal_training_dataset ORDER BY quality_score DESC, created_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  const countResult = await pool.query(`SELECT COUNT(*) FROM legal_training_dataset`);
  return { examples: result.rows, total: parseInt(countResult.rows[0].count) };
}

async function getDatasetStats() {
  const result = await pool.query(`
    SELECT
      COUNT(*) AS total,
      COUNT(DISTINCT legal_field) AS fields,
      AVG(quality_score)::numeric(3,1) AS avg_quality,
      SUM(times_used) AS total_uses,
      MAX(updated_at) AS last_updated
    FROM legal_training_dataset
  `);
  return result.rows[0];
}

// ========== INITIAL SEED DATA ==========

async function seedInitialDataset() {
  const seedData = [
    {
      question: "Ishchi ishdan asossiz bo'shatilgan. Qanday harakat qilishi kerak?",
      legal_field: "Mehnat huquqi",
      legal_issue: "Ishdan asossiz bo'shatish va ishchining huquqlari",
      applicable_law: "Mehnat kodeksi, 100-modda (mehnat shartnomasini bekor qilish asoslari), 161-modda (noqonuniy bo'shatilgan ishchining huquqlari)",
      court_practice: "Fuqarolik sudlari amaliyotida ishdan bo'shatish tartibi buzilgan hollarda ishchilar qayta tiklanmoqda. Ish beruvchi bo'shatish uchun qonuniy asos ko'rsatishi shart.",
      analysis: "Ish beruvchi Mehnat kodeksining 100-moddasida ko'rsatilgan asoslarsiz ishchini bo'shata olmaydi. Bo'shatish tartibi buzilgan bo'lsa, 161-moddaga ko'ra ishchi sud orqali ish joyiga qayta tiklanish va majburiy ishdan bo'sh turgan davr uchun o'rtacha ish haqi olish huquqiga ega.",
      correct_answer: "Bo'shatish noqonuniy deb topilishi mumkin. Ishchi fuqarolik sudiga da'vo ariza berishi, ish joyiga qayta tiklanishni va majburiy bo'sh turgan davr uchun kompensatsiya olishni so'rashi kerak.",
      source: "Mehnat kodeksi + sud amaliyoti",
      keywords: ["ishdan bo'shatish", "mehnat", "qayta tiklash", "kompensatsiya", "100-modda", "161-modda"]
    },
    {
      question: "Kvartira sotib olish shartnomasi notarial tasdiqlash talab qiladimi?",
      legal_field: "Fuqarolik huquqi",
      legal_issue: "Ko'chmas mulk sotish-sotib olish shartnomasini rasmiylashtirish tartibi",
      applicable_law: "Fuqarolik kodeksi, 482-modda (ko'chmas mulkka oid bitimlarni davlat ro'yxatidan o'tkazish), 109-modda (bitim shakli)",
      court_practice: "Sudlar notarial tasdiqlanmagan va davlat ro'yxatidan o'tkazilmagan ko'chmas mulk bitimlari haqiqiy emas deb topmoqda.",
      analysis: "O'zbekiston qonunchiligiga ko'ra ko'chmas mulk sotish-sotib olish shartnomasi notarial tasdiqlashni talab qiladi va davlat ro'yxatidan o'tkazilishi shart. Aks holda shartnoma haqiqiy emas deb topiladi.",
      correct_answer: "Ha, kvartira sotish-sotib olish shartnomasi majburiy notarial tasdiqlash va Kadastr agentligida davlat ro'yxatidan o'tkazishni talab qiladi. Buni bajarmaslik shartnomani haqiqiy emas deb topilishiga olib keladi.",
      source: "Fuqarolik kodeksi",
      keywords: ["kvartira", "sotish", "notarius", "shartnoma", "ko'chmas mulk", "kadastr", "482-modda"]
    },
    {
      question: "Qarz bergan pulim qaytarilmayapti. Nima qilishim kerak?",
      legal_field: "Fuqarolik huquqi",
      legal_issue: "Qarz shartnomasi bo'yicha pulni undirish",
      applicable_law: "Fuqarolik kodeksi, 732-modda (qarz shartnomasi), 733-modda (qarz majburiyatini bajarish tartibi), Fuqarolik protsessual kodeks, 138-modda (sud buyrug'i)",
      court_practice: "Qarz shartnomasi yoki tilxat asosida sudlar ko'pincha qarzni undirish to'g'risida qaror chiqarmoqda. Yozma dalil bo'lmagan hollarda isbotlash qiyinlashadi.",
      analysis: "Qarz berish yozma ravishda (tilxat yoki shartnoma bilan) rasmiylashtirilgan bo'lsa, qarz oluvchidan sudda undirish mumkin. 10 BHM dan ortiq miqdor uchun yozma shakl majburiy. FPK 138-moddasi bo'yicha sud buyrug'i tezkorroq variant.",
      correct_answer: "Yozma dalil (tilxat/shartnoma) mavjud bo'lsa, fuqarolik sudiga da'vo ariza yoki sud buyrug'i so'rovi bering. Yozma dalil bo'lmasa, boshqa dalillar (SMS, guvohlar) to'plash kerak.",
      source: "Fuqarolik kodeksi + FPK",
      keywords: ["qarz", "pul", "undirish", "tilxat", "sud buyrug'i", "732-modda"]
    },
    {
      question: "Er-xotin ajrashmoqchi. Bolalar kimda qoladi?",
      legal_field: "Oila huquqi",
      legal_issue: "Nikohni bekor qilish va bolalar taqdiriga oid masalalar",
      applicable_law: "Oila kodeksi, 38-modda (nikohni sud tartibida bekor qilish), 68-modda (ota-onaning bola tarbiyasida teng huquqlari), 75-modda (bolaning yashash joyini belgilash)",
      court_practice: "Sudlar bolaning manfaatlarini birinchi o'ringa qo'yib, yoshi, bog'liqligi, ota-onaning moddiy-ma'naviy sharoitini hisobga oladi. Ko'pincha kichik yoshdagi bolalar onaga qoldiriladi.",
      analysis: "Nikoh sud tartibida bekor qilinadi (voyaga yetmagan bolalar bo'lsa). Bolaning yashash joyi sud tomonidan belgilanadi. 10 yoshdan oshgan bola o'z fikrini bildirishga haqli. Sud bolaning manfaatlari, ota-onaning moddiy sharoiti va tarbiya qobiliyatini baholaydi.",
      correct_answer: "Ajrashish uchun sudga murojaat qiling. Bolalar masalasi bo'yicha sud bolaning manfaatlarini hisobga oladi. 10 yoshdan oshgan bola o'z fikrini bildiradi. Alimentlar alohida talab qilinadi.",
      source: "Oila kodeksi + sud amaliyoti",
      keywords: ["ajrashish", "nikoh", "bola", "aliment", "oila", "38-modda", "75-modda"]
    },
    {
      question: "Do'konda nuqsonli tovar sotib oldim. Pulni qaytarib olsam bo'ladimi?",
      legal_field: "Iste'molchilar huquqi",
      legal_issue: "Nuqsonli tovar uchun pulni qaytarish huquqi",
      applicable_law: "Iste'molchilar huquqlarini himoya qilish to'g'risidagi qonun, 22-modda (tovar nuqsonlari uchun javobgarlik), 26-modda (tovarni almashtirish yoki pulni qaytarish)",
      court_practice: "Iste'molchi tovar nuqsonini sotuvchiga yozma bildirib, javob olmasa sud orqali himoyalanadi. Sudlar iste'molchi foydasiga tez-tez qaror chiqarmoqda.",
      analysis: "Iste'molchi nuqsonli tovarni 14 kun ichida qaytarish yoki almashtirish huquqiga ega. Sotuvchi majburiy tarzda tovarni almashtirishi yoki pulni qaytarishi kerak. Javob bermasa, iste'molchi sudga murojaat qilishi mumkin.",
      correct_answer: "Ha. Do'konga yozma da'vo yozing. 14 kun ichida nuqsonli tovarni almashtirishni yoki pulni qaytarishni talab qiling. Javob olmasa, iste'molchilar huquqlarini himoya qilish inspeksiyasiga yoki sudga murojaat qiling.",
      source: "Iste'molchilar huquqlarini himoya qilish qonuni",
      keywords: ["tovar", "nuqson", "qaytarish", "iste'molchi", "do'kon", "22-modda", "26-modda"]
    },
    {
      question: "Qo'shni er uchastkamga o'z hududini kengaytirgan. Nima qilaman?",
      legal_field: "Yer huquqi",
      legal_issue: "Yer uchastkasiga noqonuniy egalik qilish va yer nizolarini hal etish",
      applicable_law: "Yer kodeksi, 36-modda (yer uchastkalari chegaralari), 165-modda (yer nizolarini hal qilish tartibi), Ma'muriy javobgarlik kodeksi, 68-modda",
      court_practice: "Yer nizolari bo'yicha sudlar kadastr hujjatlarini asosiy dalil sifatida qabul qiladi. Noqonuniy egalik qilish jarima bilan jazolanadi.",
      analysis: "Qo'shni yer uchastka chegarasini buzgan bo'lsa, avval hokim apparati yer bo'limiga murojaat qiling. Kadastr o'lchovi o'tkaziladi. Agar nizo hal bo'lmasa, sudga da'vo ariza bering. Noqonuniy egalik qilish MJK 68-modda bo'yicha jarima bilan jazolanadi.",
      correct_answer: "1) Tuman hokim apparati yer bo'limiga yozma ariza bering. 2) Kadastr o'lchovi o'tkazilsin. 3) Nizo hal bo'lmasa, fuqarolik sudiga da'vo ariza bering. 4) MJK 68-modda bo'yicha qo'shni ma'muriy javobgarlikka tortilishi mumkin.",
      source: "Yer kodeksi + MJK",
      keywords: ["yer", "uchastka", "qo'shni", "chegara", "kadastr", "36-modda", "165-modda"]
    },
    {
      question: "Sotuv shartnomasi tuzilganidan keyin sotuvchi shartnomani bajarishdan bosh tortmoqda.",
      legal_field: "Fuqarolik huquqi",
      legal_issue: "Shartnoma majburiyatlarini bajarmaslik va sudda himoyalanish",
      applicable_law: "Fuqarolik kodeksi, 349-modda (shartnomani bajarish majburiyati), 354-modda (majburiyatni buzganlik uchun javobgarlik), 448-modda (sotish-sotib olish shartnomasi)",
      court_practice: "Sudlar shartnoma shartlarini buzgan tomondan zarar va penya undirish haqida qaror chiqarmoqda.",
      analysis: "FK 349-moddaga ko'ra shartnoma tomonlar uchun majburiydir. Sotuvchi shartnomani bajarishdan bosh tortsa, xaridor sudda shartnomani majburiy bajarishni yoki zarar undirishni talab qilishi mumkin. 354-modda bo'yicha neustoyyka ham undirilishi mumkin.",
      correct_answer: "Sotuvchiga yozma ogohlantirish yuboring (pretenziya). 15 kun ichida javob olmasa, fuqarolik sudiga da'vo ariza bering: shartnomani majburiy bajarish + zarar undirish + neustoyyka so'rang.",
      source: "Fuqarolik kodeksi",
      keywords: ["shartnoma", "bajarmaslik", "sotish", "zarar", "neustoyyka", "349-modda", "354-modda"]
    },
    {
      question: "O'g'irlik jinoyati uchun qanday jazo belgilangan?",
      legal_field: "Jinoyat huquqi",
      legal_issue: "O'g'irlik jinoyati va jazo choralari",
      applicable_law: "Jinoyat kodeksi, 169-modda (o'g'irlik), 25-modda (jinoyat tushunchasi)",
      court_practice: "Sudlar o'g'irlik miqdori, usuli va takroriyligiga qarab turli jazolar belgilamoqda: jarimadan to ozodlikdan mahrum qilishgacha.",
      analysis: "JK 169-moddaga ko'ra o'g'irlik — boshqa shaxs mulkini yashirincha o'zlashtirish. Jazo o'g'irlik miqdori va holatiga qarab belgilanadi: kichik miqdor — jarima yoki isloh ishlari; katta miqdor — ozodlikdan mahrum qilish 3-5 yilgacha; alohida katta miqdor — 5-10 yilgacha.",
      correct_answer: "O'g'irlik uchun JK 169-modda bo'yicha jarimadan 10 yilgacha ozodlikdan mahrum qilish ko'zda tutilgan. Aniq jazo o'g'irlik miqdori, guruhda sodir etilganligi va boshqa oshiruvchi holatlarга bog'liq.",
      source: "Jinoyat kodeksi",
      keywords: ["o'g'irlik", "jinoyat", "jazo", "169-modda", "ozodlikdan mahrum"]
    },
    {
      question: "Yakka tartibdagi tadbirkor bo'lib ro'yxatdan o'tish tartibi qanday?",
      legal_field: "Tadbirkorlik huquqi",
      legal_issue: "YaTT sifatida ro'yxatdan o'tish tartibi va shartlari",
      applicable_law: "Tadbirkorlik faoliyati erkinligining kafolatlari to'g'risidagi qonun, 15-modda (ro'yxatdan o'tish tartibi), Soliq kodeksi, 394-modda (soliq to'lash tartibi)",
      court_practice: "Biznes registr orqali onlayn ro'yxatdan o'tish tizimi joriy etilgan. Sud amaliyotida noqonuniy rad etish holatlari bekor qilingan.",
      analysis: "YaTT ro'yxatdan o'tish soliq organida amalga oshiriladi. Hozirda my.gov.uz portali orqali onlayn ro'yxatdan o'tish mumkin. Zarur hujjatlar: pasport, foto, ariza. Ro'yxatdan o'tish 1 ish kuni ichida amalga oshiriladi.",
      correct_answer: "my.gov.uz portaliga kiring → Biznes registr bo'limida ariza to'ldiring → Pasport nusxasi va foto yuklang → 1 ish kuni ichida guvohnoma oling. Soliq tizimini tanlang (patent yoki umumbelgilangan).",
      source: "Tadbirkorlik qonuni + Soliq kodeksi",
      keywords: ["YaTT", "tadbirkor", "ro'yxatdan o'tish", "biznes", "soliq", "patent"]
    },
    {
      question: "Mehmonxonada shaxsiy buyumlarim yo'qoldi. Mehmonxona javobgarmi?",
      legal_field: "Fuqarolik huquqi",
      legal_issue: "Mehmonxona xizmati davomida mulk saqlash javobgarligi",
      applicable_law: "Fuqarolik kodeksi, 819-modda (saqlash shartnomasiz javobgarlik), 809-modda (mol-mulkni saqlash majburiyati)",
      court_practice: "Sudlar mehmonxonalar muassasaning saqlash majburiyatini dalillar asosida baholaydi. Seyfga topshirilgan buyumlar uchun to'liq javobgarlik, xonada qoldirilganlar uchun esa cheklangan.",
      analysis: "FK 819-moddaga ko'ra mehmonxona mehmon buyumlarini saqlash uchun javobgar — seyfga topshirilgan bo'lsa to'liq, xonada qoldirilgan bo'lsa — mehmonxona aybini isbotlash kerak.",
      correct_answer: "Darhol mehmonxona ma'muriyatiga yozma murojaat qiling va politsiyaga ariza bering. Mehmonxona javobgarlikdan qochsa, fuqarolik sudiga da'vo bering. FK 819-modda asosida zarar undirilishi mumkin.",
      source: "Fuqarolik kodeksi",
      keywords: ["mehmonxona", "buyum", "yo'qolish", "saqlash", "javobgarlik", "819-modda"]
    }
  ];

  for (const item of seedData) {
    await pool.query(
      `INSERT INTO legal_training_dataset
       (question, legal_field, legal_issue, applicable_law, court_practice, analysis, correct_answer, source, keywords, quality_score)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 8)`,
      [item.question, item.legal_field, item.legal_issue, item.applicable_law, item.court_practice, item.analysis, item.correct_answer, item.source, item.keywords]
    );
  }

  console.log(`[LEGAL DATASET] Seeded ${seedData.length} initial examples`);
}

module.exports = {
  initLegalDataset,
  retrieveSimilarExamples,
  formatExamplesForPrompt,
  addExample,
  updateExample,
  deleteExample,
  getAllExamples,
  getDatasetStats,
};
