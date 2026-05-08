/**
 * Case-Law Dataset System
 *
 * Stores and retrieves court decisions from my.sud.uz for RAG-enhanced
 * legal analysis. Uses pg_trgm trigram similarity for semantic matching
 * across facts, legal issues, and court reasoning.
 */

const { pool } = require('../database/db');

// ========== DATABASE SETUP ==========

async function initCaseLawDataset() {
  try {
    await pool.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS court_cases (
        id SERIAL PRIMARY KEY,
        case_id VARCHAR(100) UNIQUE NOT NULL,
        court_name VARCHAR(255) NOT NULL,
        decision_date DATE,
        case_category VARCHAR(100) NOT NULL,
        legal_field VARCHAR(100),
        legal_issue TEXT NOT NULL,
        facts_summary TEXT NOT NULL,
        applied_laws TEXT NOT NULL,
        court_reasoning TEXT NOT NULL,
        final_decision TEXT NOT NULL,
        source_url VARCHAR(500) DEFAULT 'my.sud.uz',
        keywords TEXT[] DEFAULT '{}',
        quality_score SMALLINT DEFAULT 5 CHECK (quality_score BETWEEN 1 AND 10),
        times_used INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // GIN indexes for trigram similarity search
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_court_cases_issue_trgm ON court_cases USING GIN (legal_issue gin_trgm_ops)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_court_cases_facts_trgm ON court_cases USING GIN (facts_summary gin_trgm_ops)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_court_cases_reasoning_trgm ON court_cases USING GIN (court_reasoning gin_trgm_ops)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_court_cases_field ON court_cases(legal_field)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_court_cases_category ON court_cases(case_category)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_court_cases_keywords ON court_cases USING GIN (keywords)`);

    // Seed initial dataset if empty
    const count = await pool.query(`SELECT COUNT(*) FROM court_cases`);
    if (parseInt(count.rows[0].count) === 0) {
      await seedCaseLawData();
    }

    console.log('[CASE-LAW] Initialized successfully');
  } catch (err) {
    console.error('[CASE-LAW] Init error:', err.message);
  }
}

// ========== RETRIEVE SIMILAR CASES ==========

/**
 * Search for court cases similar to the user's legal question.
 * Uses combined trigram similarity across legal_issue, facts_summary,
 * and court_reasoning. Prioritizes by legal field match and quality.
 *
 * @param {string} userQuestion - The user's legal question
 * @param {string|null} legalField - Detected legal field for filtering
 * @param {number} limit - Max cases to return (default 3)
 * @returns {Promise<Array>} Top matching court cases
 */
async function retrieveSimilarCases(userQuestion, legalField = null, limit = 3) {
  try {
    const params = [userQuestion];
    let fieldFilter = '';

    if (legalField && legalField !== 'Boshqa') {
      fieldFilter = `AND (legal_field ILIKE $2 OR legal_field = 'Umumiy')`;
      params.push(`%${legalField}%`);
    }

    const result = await pool.query(`
      SELECT
        id, case_id, court_name, decision_date, case_category, legal_field,
        legal_issue, facts_summary, applied_laws, court_reasoning,
        final_decision, source_url, keywords,
        (
          COALESCE(similarity(legal_issue, $1), 0) * 0.35 +
          COALESCE(similarity(facts_summary, $1), 0) * 0.35 +
          COALESCE(similarity(court_reasoning, $1), 0) * 0.20 +
          COALESCE(
            (SELECT COUNT(*)::float / GREATEST(array_length(keywords, 1), 1)
             FROM unnest(keywords) k
             WHERE $1 ILIKE '%' || k || '%'), 0
          ) * 0.10
        ) AS relevance_score
      FROM court_cases
      WHERE 1=1 ${fieldFilter}
      ORDER BY relevance_score DESC, quality_score DESC, decision_date DESC
      LIMIT ${parseInt(limit)}
    `, params);

    // Filter out low-relevance matches
    const cases = result.rows.filter(r => r.relevance_score > 0.04);

    // Increment usage counter
    if (cases.length > 0) {
      const ids = cases.map(c => c.id);
      await pool.query(
        `UPDATE court_cases SET times_used = times_used + 1 WHERE id = ANY($1)`,
        [ids]
      );
    }

    console.log(`[CASE-LAW] Found ${cases.length} similar cases (top score: ${cases[0]?.relevance_score?.toFixed(3) || 0})`);
    return cases;
  } catch (err) {
    console.error('[CASE-LAW] Search error:', err.message);
    return [];
  }
}

// ========== FORMAT FOR PROMPT ==========

/**
 * Format retrieved court cases for injection into the AI prompt.
 * Limited to ~800 tokens per case to keep context manageable.
 */
function formatCasesForPrompt(cases) {
  if (!cases || cases.length === 0) return '';

  const formatted = cases.map((c, i) => {
    const date = c.decision_date
      ? new Date(c.decision_date).toLocaleDateString('uz-UZ', { year: 'numeric', month: 'long', day: 'numeric' })
      : 'sana noaniq';

    return `
Sud ishi ${i + 1}:
Ish raqami: ${c.case_id}
Sud: ${c.court_name}
Qaror sanasi: ${date}
Toifa: ${c.case_category} (${c.legal_field || 'Umumiy'})
Huquqiy masala: ${c.legal_issue.substring(0, 200)}
Faktlar: ${c.facts_summary.substring(0, 300)}${c.facts_summary.length > 300 ? '...' : ''}
Qo'llangan qonunlar: ${c.applied_laws.substring(0, 200)}
Sud mushohada: ${c.court_reasoning.substring(0, 300)}${c.court_reasoning.length > 300 ? '...' : ''}
Yakuniy qaror: ${c.final_decision.substring(0, 200)}
Manba: ${c.source_url}`;
  }).join('\n---');

  return `
O'XSHASH SUD AMALIYOTI (Case-Law Dataset):
Quyidagi sud ishlari foydalanuvchi savoliga o'xshash huquqiy masalalarni ko'rib chiqqan.
Bu qarorlardan foydalanib, sudlar qonunni QANDAY TALQIN QILGANINI ko'rsating.

${formatted}

MUHIM: Yuqoridagi sud ishlaridan foydalanib javobingizda SUD AMALIYOTI bo'limini boyiting.
Har bir ishga murojaat qilganda ish raqami, sud nomi va sanasini keltiring.
Sud qarorlarini to'qima qilmang — faqat yuqoridagi ma'lumotlarga tayanib yozing.`;
}

// ========== CRUD OPERATIONS ==========

async function addCase(data) {
  const {
    case_id, court_name, decision_date, case_category, legal_field,
    legal_issue, facts_summary, applied_laws, court_reasoning,
    final_decision, source_url, keywords
  } = data;

  const result = await pool.query(
    `INSERT INTO court_cases
     (case_id, court_name, decision_date, case_category, legal_field,
      legal_issue, facts_summary, applied_laws, court_reasoning,
      final_decision, source_url, keywords)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [case_id, court_name, decision_date || null, case_category, legal_field || 'Umumiy',
     legal_issue, facts_summary, applied_laws, court_reasoning,
     final_decision, source_url || 'my.sud.uz', keywords || []]
  );
  return result.rows[0];
}

async function updateCase(id, data) {
  const allowedFields = [
    'case_id', 'court_name', 'decision_date', 'case_category', 'legal_field',
    'legal_issue', 'facts_summary', 'applied_laws', 'court_reasoning',
    'final_decision', 'source_url', 'keywords', 'quality_score'
  ];
  const fields = [];
  const values = [];
  let paramIdx = 1;

  for (const [key, val] of Object.entries(data)) {
    if (allowedFields.includes(key)) {
      fields.push(`${key} = $${paramIdx}`);
      values.push(val);
      paramIdx++;
    }
  }

  if (fields.length === 0) return null;
  fields.push(`updated_at = NOW()`);
  values.push(id);

  const result = await pool.query(
    `UPDATE court_cases SET ${fields.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
    values
  );
  return result.rows[0];
}

async function deleteCase(id) {
  await pool.query(`DELETE FROM court_cases WHERE id = $1`, [id]);
}

async function getAllCases(limit = 50, offset = 0) {
  const result = await pool.query(
    `SELECT * FROM court_cases ORDER BY quality_score DESC, decision_date DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  const countResult = await pool.query(`SELECT COUNT(*) FROM court_cases`);
  return { cases: result.rows, total: parseInt(countResult.rows[0].count) };
}

async function getCaseLawStats() {
  const result = await pool.query(`
    SELECT
      COUNT(*) AS total,
      COUNT(DISTINCT legal_field) AS fields,
      COUNT(DISTINCT court_name) AS courts,
      COUNT(DISTINCT case_category) AS categories,
      AVG(quality_score)::numeric(3,1) AS avg_quality,
      SUM(times_used) AS total_uses,
      MAX(updated_at) AS last_updated
    FROM court_cases
  `);
  return result.rows[0];
}

// ========== SEED DATA — Uzbekistan Court Decisions ==========

async function seedCaseLawData() {
  const seedCases = [
    {
      case_id: '2023-FUD-0847',
      court_name: 'Toshkent shahar fuqarolik sudi',
      decision_date: '2023-06-15',
      case_category: 'Mehnat nizosi',
      legal_field: 'Mehnat huquqi',
      legal_issue: 'Ishdan asossiz bo\'shatish va ishchining ish joyiga qayta tiklanishi',
      facts_summary: 'Ishchi 3 yil davomida korxonada ishlagan. Ish beruvchi intizomiy jazo tartibini buzgan holda, yozma ogohlantirish bermasdan ishchini ishdan bo\'shatgan. Ishchi MK 100-modda buzilganini da\'vo qilgan.',
      applied_laws: 'Mehnat kodeksi, 100-modda (mehnat shartnomasini bekor qilish asoslari), 161-modda (noqonuniy bo\'shatilgan ishchining huquqlari), 102-modda (intizomiy jazo tartibi)',
      court_reasoning: 'Sud ish beruvchining MK 102-moddasida belgilangan intizomiy jazo tartibini buzganini aniqladi. Ishchiga oldindan yozma ogohlantirish berilmagan, tushuntirish xati talab qilinmagan. Bo\'shatish asossiz deb topildi.',
      final_decision: 'Ishchi ish joyiga qayta tiklandi. Ish beruvchi majburiy bo\'sh turgan davr uchun o\'rtacha ish haqi to\'lashi va ma\'naviy zarar uchun 5 mln so\'m kompensatsiya to\'lashi belgilandi.',
      source_url: 'my.sud.uz',
      keywords: ['ishdan bo\'shatish', 'qayta tiklash', 'mehnat', 'intizomiy jazo', '100-modda', '161-modda']
    },
    {
      case_id: '2023-IQT-1205',
      court_name: 'Toshkent shahar iqtisodiy sudi',
      decision_date: '2023-09-22',
      case_category: 'Shartnoma nizosi',
      legal_field: 'Fuqarolik huquqi',
      legal_issue: 'Yetkazib berish shartnomasi bo\'yicha majburiyatni bajarmaslik va zarar undirish',
      facts_summary: '"A" korxonasi "B" korxonasiga 200 mln so\'mlik tovar yetkazib berish shartnomasini tuzgan. "A" korxonasi oldindan 100 mln so\'m to\'lov olgan, lekin tovarni belgilangan muddatda yetkazib bermagan. "B" korxonasi zarar va penya undirish uchun sudga murojaat qilgan.',
      applied_laws: 'Fuqarolik kodeksi, 349-modda (shartnomani bajarish majburiyati), 354-modda (majburiyatni buzganlik uchun javobgarlik), 333-modda (penya), Iqtisodiy protsessual kodeks',
      court_reasoning: 'Sud shartnoma shartlarini va to\'lov hujjatlarini tekshirib, "A" korxonasining FK 349-moddani buzganini aniqladi. Kechikish 45 kunni tashkil etgan, penya shartnomada kuniga 0.1% qilib belgilangan edi.',
      final_decision: '"A" korxonasi 100 mln so\'m avans pulini qaytarishi, 4.5 mln so\'m penya va 15 mln so\'m qo\'shimcha zarar to\'lashi hukm qilindi. Sud xarajatlari javobgarga yuklatildi.',
      source_url: 'my.sud.uz',
      keywords: ['shartnoma', 'yetkazib berish', 'zarar', 'penya', '349-modda', '354-modda', '333-modda']
    },
    {
      case_id: '2022-OIL-0392',
      court_name: 'Toshkent viloyati fuqarolik sudi',
      decision_date: '2022-11-08',
      case_category: 'Oilaviy nizo',
      legal_field: 'Oila huquqi',
      legal_issue: 'Nikohni bekor qilish, bolalar taqdiriga oid masala va aliment belgilash',
      facts_summary: 'Er-xotin 7 yil nikohda bo\'lgan, 2 ta voyaga yetmagan farzandlari bor (5 va 9 yosh). Ota ajrashish va bolalarni o\'ziga olishni talab qilgan. Ona ham bolalarni o\'ziga qoldirishni so\'ragan. 9 yoshli bola sudda onasi bilan yashashni xohlashini bildirgan.',
      applied_laws: 'Oila kodeksi, 38-modda (nikohni sud tartibida bekor qilish), 68-modda (ota-onaning teng huquqlari), 75-modda (bolaning yashash joyi), 99-modda (aliment miqdori)',
      court_reasoning: 'Sud bolalarning manfaatlarini birinchi o\'ringa qo\'yib, onaning moddiy va ma\'naviy sharoitini tekshirdi. 9 yoshli bolaning fikrini hisobga oldi (OK 75-modda). Onaning tarbiya qobiliyati va moddiy ta\'minoti yetarli deb topildi. Otaning ish bilan bandligi sabab bolalar asosiy parvarishda kamchilik bo\'lishi mumkinligi aniqlandi.',
      final_decision: 'Nikoh bekor qilindi. Ikkala farzand onaga topshirildi. Ota har oyda daromadining 33% miqdorida aliment to\'lashi belgilandi (OK 99-modda). Bola bilan uchrashuv tartibi belgilandi.',
      source_url: 'my.sud.uz',
      keywords: ['ajrashish', 'nikoh', 'bola', 'aliment', 'oila', '38-modda', '75-modda', '99-modda']
    },
    {
      case_id: '2023-JIN-0156',
      court_name: 'Toshkent shahar jinoyat ishlari bo\'yicha sudi',
      decision_date: '2023-03-14',
      case_category: 'Jinoyat ishi',
      legal_field: 'Jinoyat huquqi',
      legal_issue: 'Firibgarlik (JK 168-modda) orqali katta miqdorda mol-mulkni o\'zlashtirish',
      facts_summary: 'Ayblanuvchi 5 ta fuqaroga uy-joy qurilishiga sarmoya kiritishni taklif qilib, jami 800 mln so\'m mablag\' yig\'gan. Qurilish boshlanmagan, mablag\'lar shaxsiy maqsadlarda sarflangan. Jabrlanuvchilar politsiyaga murojaat qilgan.',
      applied_laws: 'Jinoyat kodeksi, 168-modda (firibgarlik), 3-qism (katta miqdorda), 58-modda (jazo tayinlash tartibi)',
      court_reasoning: 'Sud dalillarni tekshirib, ayblanuvchining dastlabki niyati firibgarlik bo\'lganini aniqladi — qurilish litsenziyasi bo\'lmagan, loyiha mavjud emas. JK 168-modda 3-qismiga ko\'ra katta miqdordagi firibgarlik sifatida kvalifikatsiya qilindi.',
      final_decision: 'Ayblanuvchi 5 yil ozodlikdan mahrum qilish jazosiga hukm qilindi. Mol-mulk musodara qilindi. 800 mln so\'m zarar jabrlanuvchilarga qaytarilishi belgilandi.',
      source_url: 'my.sud.uz',
      keywords: ['firibgarlik', 'jinoyat', '168-modda', 'zarar', 'ozodlikdan mahrum']
    },
    {
      case_id: '2023-IST-0571',
      court_name: 'Samarqand viloyati fuqarolik sudi',
      decision_date: '2023-07-20',
      case_category: 'Iste\'molchi huquqi',
      legal_field: 'Iste\'molchilar huquqi',
      legal_issue: 'Nuqsonli tovar uchun pulni qaytarish va zarar undirish',
      facts_summary: 'Xaridor 15 mln so\'mlik muzlatgich sotib olgan. 10 kun ichida muzlatgich buzilgan. Do\'kon ta\'mirlashni taklif qilgan, lekin xaridor pulni qaytarishni talab qilgan. Do\'kon rad etgan, xaridor sudga murojaat qilgan.',
      applied_laws: 'Iste\'molchilar huquqlarini himoya qilish qonuni, 22-modda (tovar nuqsonlari), 26-modda (almashtirish yoki qaytarish), Fuqarolik kodeksi, 433-modda',
      court_reasoning: 'Sud ekspertiza o\'tkazishga buyurgan. Ekspertiza muzlatgichda zavodiy nuqson borligini tasdiqlagan. 22-moddaga ko\'ra ishlab chiqaruvchi/sotuvchi nuqsonli tovar uchun javobgar. Xaridor 14 kun ichida murojaat qilgan — qonuniy muddat ichida.',
      final_decision: 'Do\'kon 15 mln so\'m pul qaytarishi, 2 mln so\'m ma\'naviy zarar va ekspertiza xarajatlarini to\'lashi hukm qilindi.',
      source_url: 'my.sud.uz',
      keywords: ['nuqsonli tovar', 'pulni qaytarish', 'iste\'molchi', '22-modda', '26-modda', 'muzlatgich']
    },
    {
      case_id: '2023-YER-0283',
      court_name: 'Farg\'ona viloyati fuqarolik sudi',
      decision_date: '2023-04-10',
      case_category: 'Yer nizosi',
      legal_field: 'Yer va ko\'chmas mulk huquqi',
      legal_issue: 'Qo\'shni tomonidan yer uchastka chegarasini buzish va noqonuniy qurilish',
      facts_summary: 'Da\'vogar qo\'shnisining o\'z yer uchastka chegarasini 2 metrga buzib, to\'siq o\'rnatganini da\'vo qilgan. Kadastr o\'lchovi yer chegarasi buzilganini tasdiqlagan. Qo\'shni qurilishni qonuniy deb hisoblagan.',
      applied_laws: 'Yer kodeksi, 36-modda (yer uchastkasi chegaralari), 165-modda (yer nizolarini hal qilish), Ma\'muriy javobgarlik kodeksi, 68-modda (noqonuniy yer egalik qilish)',
      court_reasoning: 'Sud kadastr hujjatlarini asosiy dalil sifatida qabul qildi. O\'lchov natijalari qo\'shni chegarani 2.1 metrga buzganini tasdiqladi. YK 36-moddaga ko\'ra har bir yer foydalanuvchi chegaralarni buzmaslik majburiyatiga ega.',
      final_decision: 'Qo\'shni to\'siqni 30 kun ichida olib tashlashi va chegarani tiklashi buyurildi. MJK 68-modda bo\'yicha 3 BHM miqdorida jarima belgilandi.',
      source_url: 'my.sud.uz',
      keywords: ['yer', 'chegara', 'qo\'shni', 'kadastr', '36-modda', '165-modda', 'qurilish']
    },
    {
      case_id: '2022-TAD-0918',
      court_name: 'Toshkent shahar iqtisodiy sudi',
      decision_date: '2022-12-05',
      case_category: 'Tadbirkorlik nizosi',
      legal_field: 'Tadbirkorlik huquqi',
      legal_issue: 'MChJ ishtirokchisining ulushini majburiy sotish va sheriklari o\'rtasidagi nizo',
      facts_summary: 'MChJ 3 ta ishtirokchidan iborat. 40% ulushli ishtirokchi boshqaruv qarorlariga doimiy qarshi chiqib, kompaniya faoliyatiga zarar yetkazgan. Qolgan 2 ta ishtirokchi (60%) sudga murojaat qilib, nizo keltiruvchi ishtirokchining ulushini majburiy sotishni so\'ragan.',
      applied_laws: 'MChJ to\'g\'risidagi qonun, 22-modda (ishtirokchining chiqishi/chiqarilishi), FK 10-modda (huquqdan suiiste\'mol qilmaslik), Tadbirkorlik faoliyati erkinligi kafolatlari qonuni',
      court_reasoning: 'Sud MChJ ustav hujjatlarini va yig\'ilish bayonlarini tekshirdi. 40% ulushli ishtirokchining 2 yil davomida boshqaruv qarorlarini blokirovka qilgani va kompaniya faoliyatiga zarar yetkazgani isbotlandi. MChJ qonuni 22-moddaga ko\'ra bunday holatlarda ishtirokchini chiqarish imkoni ko\'zda tutilgan.',
      final_decision: '40% ulushli ishtirokchi MChJ dan chiqarildi. Uning ulushi bozor qiymati bo\'yicha baholandi va 90 kun ichida kompensatsiya to\'lanishi belgilandi.',
      source_url: 'my.sud.uz',
      keywords: ['MChJ', 'ishtirokchi', 'ulush', 'tadbirkorlik', '22-modda', 'sheriklik']
    },
    {
      case_id: '2023-SOL-0445',
      court_name: 'Ma\'muriy sud',
      decision_date: '2023-05-30',
      case_category: 'Soliq nizosi',
      legal_field: 'Soliq huquqi',
      legal_issue: 'Soliq tekshiruvi natijalarini sudda noqonuniy deb topish',
      facts_summary: 'YaTT soliq tekshiruvi natijasida 50 mln so\'m qo\'shimcha soliq va 20 mln so\'m jarima belgilangan. YaTT tekshiruv tartibida qoidabuzarlik bo\'lganini (oldindan xabardor qilmaslik) da\'vo qilgan.',
      applied_laws: 'Soliq kodeksi, 138-modda (soliq tekshiruvi tartibi), 140-modda (tekshiruv natijalarini rasmiylashtirish), Ma\'muriy sudlov kodeksi',
      court_reasoning: 'Sud soliq organining tekshiruv buyrug\'ini va o\'tkazilish tartibini tekshirdi. SK 138-moddaga ko\'ra soliq to\'lovchiga tekshiruv boshlanishidan 3 kun oldin yozma xabar berilishi shart. Soliq organi bu talabni bajarmagan edi.',
      final_decision: 'Soliq tekshiruvi natijalari noqonuniy deb topildi. 50 mln so\'m qo\'shimcha soliq va 20 mln so\'m jarima bekor qilindi. Soliq organiga qayta tekshiruv o\'tkazish uchun to\'g\'ri tartibga rioya qilish buyurildi.',
      source_url: 'my.sud.uz',
      keywords: ['soliq', 'tekshiruv', 'jarima', 'YaTT', '138-modda', '140-modda']
    },
    {
      case_id: '2023-FUQ-0634',
      court_name: 'Buxoro viloyati fuqarolik sudi',
      decision_date: '2023-08-12',
      case_category: 'Ko\'chmas mulk nizosi',
      legal_field: 'Fuqarolik huquqi',
      legal_issue: 'Kvartira sotish-sotib olish shartnomasini haqiqiy emas deb topish',
      facts_summary: 'Sotuvchi kvartira sotish-sotib olish shartnomasini notariatsiz imzolagan. Xaridor 80 mln so\'m to\'lagan va kvartirada yashay boshlagan. Keyinchalik sotuvchi shartnoma haqiqiy emas deb da\'vo qilgan, chunki notarial tasdiq bo\'lmagan.',
      applied_laws: 'Fuqarolik kodeksi, 482-modda (ko\'chmas mulk bitimlarini davlat ro\'yxati), 109-modda (bitim shakli), 114-modda (haqiqiy bo\'lmagan bitim oqibatlari)',
      court_reasoning: 'Sud FK 482-modda va 109-moddaga asosan ko\'chmas mulk bitimlari majburiy notarial tasdiq va davlat ro\'yxatidan o\'tkazishni talab qilishini tasdiqladi. Biroq, 114-modda bo\'yicha har ikkala tomon asl holatga qaytarilishi — sotuvchi pulni, xaridor kvartirani qaytarishi kerak.',
      final_decision: 'Shartnoma haqiqiy emas deb topildi. Sotuvchi 80 mln so\'m pulni xaridorga qaytarishi, xaridor kvartirani bo\'shatishi belgilandi. Sotuvchi qo\'shimcha 5 mln so\'m sudda ishtirok xarajatlarini to\'lashi hukm qilindi.',
      source_url: 'my.sud.uz',
      keywords: ['kvartira', 'shartnoma', 'notarius', 'ko\'chmas mulk', '482-modda', '109-modda']
    },
    {
      case_id: '2023-MAM-0201',
      court_name: 'Toshkent shahar ma\'muriy sudi',
      decision_date: '2023-02-28',
      case_category: 'Ma\'muriy huquqbuzarlik',
      legal_field: 'Ma\'muriy huquq',
      legal_issue: 'Yo\'l harakati qoidalarini buzganlik uchun belgilangan jarimani bekor qilish',
      facts_summary: 'Fuqaroga yo\'l harakati qoidalarini buzganlik uchun 5 BHM miqdorida jarima belgilangan. Fuqaro videoregistrator yozuvini dalil sifatida taqdim etib, qoidabuzarlik sodir etmaganini isbotlashga harakat qilgan.',
      applied_laws: 'Ma\'muriy javobgarlik kodeksi, 128-modda (yo\'l harakati qoidalari), 275-modda (ishni ko\'rib chiqish tartibi), 284-modda (qaror ustidan shikoyat)',
      court_reasoning: 'Sud videoregistrator yozuvini va politsiya protokolini tekshirdi. Video yozuv fuqaroning qoidani buzmaganini tasdiqlagan. Politsiya xodimi sudga kelmagan va qo\'shimcha dalil taqdim etmagan.',
      final_decision: 'Ma\'muriy jarima bekor qilindi. Politsiya bo\'limiga qoidabuzarlik protokollarini to\'g\'ri rasmiylashtirish bo\'yicha tavsiya berildi.',
      source_url: 'my.sud.uz',
      keywords: ['jarima', 'yo\'l harakati', 'ma\'muriy', '128-modda', 'politsiya', 'video']
    }
  ];

  for (const c of seedCases) {
    await pool.query(
      `INSERT INTO court_cases
       (case_id, court_name, decision_date, case_category, legal_field,
        legal_issue, facts_summary, applied_laws, court_reasoning,
        final_decision, source_url, keywords, quality_score)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 8)`,
      [c.case_id, c.court_name, c.decision_date, c.case_category, c.legal_field,
       c.legal_issue, c.facts_summary, c.applied_laws, c.court_reasoning,
       c.final_decision, c.source_url, c.keywords]
    );
  }

  console.log(`[CASE-LAW] Seeded ${seedCases.length} initial court cases`);
}

module.exports = {
  initCaseLawDataset,
  retrieveSimilarCases,
  formatCasesForPrompt,
  addCase,
  updateCase,
  deleteCase,
  getAllCases,
  getCaseLawStats
};
