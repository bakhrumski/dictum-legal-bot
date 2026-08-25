(function workspaceModule(global) {
    'use strict';

    var root = null;
    var activationPromise = null;
    var currentUser = null;
    var searchTimer = null;
    var refreshTimer = null;
    var tokenTimer = null;
    var entitlementTimer = null;
    var taskPresenceChannel = null;
    var supabaseLoader = null;
    var dropdownSerial = 0;
    var datePickerSerial = 0;
    var previewMode = new URLSearchParams(global.location.search).get('workspacePreview') === '1' || document.body.dataset.workspaceStandalone === 'true';

    var ICONS = {
        add: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
        ai: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3L12 3Z"/></svg>',
        arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
        calendar: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/></svg>',
        check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>',
        chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>',
        close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
        comment: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg>',
        copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
        document: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/></svg>',
        download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 5-5m-5 5-5-5M5 21h14"/></svg>',
        help: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.4 2.4 0 1 1 3.4 2.2c-.8.4-1.2 1-1.2 1.8v.2M12 17h.01"/></svg>',
        history: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></svg>',
        list: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
        members: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/></svg>',
        more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>',
        search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>',
        send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>',
        timeline: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16M4 12h10M4 19h16"/><circle cx="17" cy="12" r="2"/></svg>',
        thumbDown: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10v12M15 5.9l-1 4.1h5.8a2 2 0 0 1 1.9 2.6l-2.3 7A2 2 0 0 1 17.5 21H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3l4-7a3 3 0 0 1 4 2.9Z" transform="rotate(180 12 12)"/></svg>',
        thumbUp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10v12M15 5.9l-1 4.1h5.8a2 2 0 0 1 1.9 2.6l-2.3 7A2 2 0 0 1 17.5 21H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3l4-7a3 3 0 0 1 4 2.9Z"/></svg>',
        upload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L7 9m5-5 5 5M5 20h14"/></svg>'
        ,graph: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="6" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="8" cy="18" r="2"/><circle cx="18" cy="17" r="2"/><path d="m8 7 8 0M7 8l1 8m2 1 6 0m1-8v6M8 8l8 7"/></svg>'
        ,chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/><path d="M8 9h8M8 13h5"/></svg>'
        ,lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>'
    };

    var COPY = {
        uz: {
            loading: 'Workspace yuklanmoqda…', workspace: 'Workspace', sharedWork: 'Jamoaviy huquqiy ish maydoni',
            newTask: 'Yangi vazifa', invite: 'A’zo taklif qilish', members: 'A’zolar', owner: 'Egasi', member: 'A’zo', viewer: 'Kuzatuvchi',
            live: 'Jonli', connecting: 'Ulanmoqda', offline: 'Ulanmagan', preview: 'Preview',
            tasks: 'Vazifalar', openTasks: 'Ochiq vazifalar', overdue: 'Muddati o‘tgan', completed: 'Yakunlangan', sharedMemory: 'Umumiy AI xotirasi',
            listView: 'Ro‘yxat', timelineView: 'Vaqt jadvali', searchTasks: 'Vazifa yoki tavsifni qidiring', allStatuses: 'Barcha holatlar', allPriorities: 'Barcha ustuvorliklar', allAssignees: 'Barcha ijrochilar',
            task: 'Vazifa', status: 'Holat', assignees: 'Ijrochilar', dueDate: 'Muddat', priority: 'Ustuvorlik',
            noTasksTitle: 'Birinchi umumiy vazifani yarating', noTasksBody: 'Masalan, shartnoma tahlili yoki xodim hujjatini vazifa qilib yarating. A’zolar, hujjatlar va AI natijalari bir joyda saqlanadi.',
            createTask: 'Vazifa yaratish', editTask: 'Vazifani tahrirlash', title: 'Nomi', description: 'Tavsif', startDate: 'Boshlanish sanasi', milestone: 'Muhim bosqich', watchers: 'Kuzatuvchilar', save: 'Saqlash', cancel: 'Bekor qilish', delete: 'O‘chirish',
            todo: 'Rejada', in_progress: 'Jarayonda', in_review: 'Tekshiruvda', done: 'Yakunlangan', cancelled: 'Bekor qilingan',
            low: 'Past', normal: 'O‘rta', high: 'Yuqori', urgent: 'Shoshilinch',
            comments: 'Izohlar', writeComment: 'Izoh yozing…', send: 'Yuborish', noComments: 'Hali izoh yo‘q. Qaror yoki yangilikni shu yerda ulashing.',
            documents: 'Hujjatlar', uploadDocument: 'Hujjat yuklash', noDocuments: 'Hujjat yoki AI natijasini ushbu vazifaga biriktiring.', versions: 'Versiyalar', version: 'versiya', download: 'Yuklab olish',
            activity: 'Faollik tarixi', noActivity: 'O‘zgarishlar shu yerda ketma-ket ko‘rinadi.',
            aiAssistant: 'Workspace AI', askAi: "AI dan so'rang", askPlaceholder: 'Vazifa, hujjatlar va jamoa xotirasi asosida savol yozing…', aiContextTask: 'Vazifa konteksti yuklandi', aiContextWorkspace: 'Workspace xotirasi va Lex.uz konteksti',
            reused: 'Oldingi tasdiqlangan natija qayta ishlatildi — yangi API xarajati yo‘q', generated: 'Yangi javob yaratildi', saveAsDocument: 'Hujjat sifatida saqlash', aiSaved: 'AI javobi vazifaga hujjat sifatida saqlandi',
            taskUpdated: 'Vazifa yangilandi', someoneUpdated: 'Boshqa a’zo bu vazifani hozirgina yangiladi. Siz eng so‘nggi holatni ko‘ryapsiz.', taskCreated: 'Vazifa yaratildi', taskDeleted: 'Vazifa o‘chirildi',
            platinumTitle: 'Platinum Workspace yarating', platinumBody: 'Workspace faqat faol Platinum tarifida mavjud. U jamoaviy vazifalar, umumiy AI xotirasi va hujjat tarixini bir joyda birlashtiradi.', workspaceName: 'Workspace nomi', createWorkspace: 'Workspace yaratish', upgradePlatinum: 'Platinum tarifini ko‘rish',
            noWorkspaceTitle: 'Jamoangiz uchun Workspace yarating', noWorkspaceBody: 'Siz Egasi bo‘lasiz va a’zolarni username yoki email orqali taklif qilasiz.',
            inviteMember: 'A’zo taklif qilish', emailOrUsername: 'Email yoki username', role: 'Rol', expires: 'Amal qilish muddati', hours72: '72 soat', days7: '7 kun', days30: '30 kun', createInvite: 'Taklif havolasini yaratish', copyLink: 'Nusxalash', copied: 'Havola nusxalandi', pendingInvites: 'Kutilayotgan takliflar', noPendingInvites: 'Kutilayotgan taklif yo‘q.',
            readOnly: 'Faqat o‘qish', readOnlyReason: 'Workspace egasining Platinum muddati tugagan yoki siz Kuzatuvchi rolidasiz.',
            error: 'Xatolik', tryAgain: 'Qayta urinish', close: 'Yopish', required: 'Majburiy maydon',
            day: 'Kunlik', week: 'Hafta', month: 'Oy', quarter: 'Chorak', timelineEmpty: 'Sanalari belgilangan vazifalar bu yerda ko‘rinadi.', timelineMobile: 'Vaqt jadvalini qulay boshqarish uchun desktop qurilmadan foydalaning.',
            shortcuts: 'Klaviatura yorliqlari', shortcutNew: 'Yangi vazifa', shortcutSearch: 'Vazifalarni qidirish', shortcutHelp: 'Yordam oynasi',
            confirmDeleteTask: 'Bu vazifani o‘chirasizmi?', uploadFailed: 'Faylni yuklab bo‘lmadi', uploadComplete: 'Hujjat yuklandi',
            noAccess: 'Workspace’ga kirish mavjud emas', unauthorizedBody: 'Taklif havolasini qabul qiling yoki Workspace egasidan ruxsat so‘rang.',
            updatedNow: 'hozirgina yangiladi', unscheduled: 'Sana belgilanmagan', taskDetails: 'Vazifa tafsilotlari', morePeople: 'yana', language: 'Til',
            workspaceError: 'Workspace ma’lumotlarini yuklab bo‘lmadi', memberManagement: 'A’zolar va rollar', activePlanRequired: 'Faol Platinum talab qilinadi',
            fileTooLarge: 'Fayl 50 MB dan kichik bo‘lishi kerak', unsupportedFile: 'Bu fayl turi qo‘llab-quvvatlanmaydi',
            aiThinking: 'Jamoa xotirasi va huquqiy manbalar tekshirilmoqda…', aiFailed: 'AI javobini olib bo‘lmadi', threadHistory: 'Suhbat tarixi', newConversation: 'Yangi suhbat',
            taskLinkHint: 'Bu javob vazifa, hujjatlar va jamoaning oldingi natijalari bilan birga saqlanadi.',
            previewNotice: 'Bu xavfsiz UI preview — server ma’lumotlari o‘zgarmaydi.'
        },
        ru: {
            loading:'Workspace загружается…', workspace:'Workspace', sharedWork:'Общее юридическое рабочее пространство', newTask:'Новая задача', invite:'Пригласить участника', members:'Участники', owner:'Владелец', member:'Участник', viewer:'Наблюдатель', live:'Онлайн', connecting:'Подключение', offline:'Нет связи', preview:'Preview', tasks:'Задачи', openTasks:'Открытые задачи', overdue:'Просрочено', completed:'Завершено', sharedMemory:'Общая память AI', listView:'Список', timelineView:'Лента', searchTasks:'Поиск задачи или описания', allStatuses:'Все статусы', allPriorities:'Все приоритеты', allAssignees:'Все исполнители', task:'Задача', status:'Статус', assignees:'Исполнители', dueDate:'Срок', priority:'Приоритет', noTasksTitle:'Создайте первую общую задачу', noTasksBody:'Создайте задачу по договору или кадровому документу. Участники, документы и результаты AI сохраняются вместе.', createTask:'Создать задачу', editTask:'Редактировать задачу', title:'Название', description:'Описание', startDate:'Дата начала', milestone:'Веха', watchers:'Наблюдатели', save:'Сохранить', cancel:'Отмена', delete:'Удалить', todo:'Запланировано', in_progress:'В работе', in_review:'На проверке', done:'Завершено', cancelled:'Отменено', low:'Низкий', normal:'Средний', high:'Высокий', urgent:'Срочный', comments:'Комментарии', writeComment:'Напишите комментарий…', send:'Отправить', noComments:'Комментариев пока нет. Поделитесь решением или обновлением.', documents:'Документы', uploadDocument:'Загрузить документ', noDocuments:'Прикрепите документ или результат AI к этой задаче.', versions:'Версии', version:'версия', download:'Скачать', activity:'История действий', noActivity:'Изменения появятся здесь по порядку.', aiAssistant:'Workspace AI', askAi:'Спросить AI', askPlaceholder:'Задайте вопрос с учетом задачи, документов и памяти команды…', aiContextTask:'Контекст задачи загружен', aiContextWorkspace:'Память Workspace и контекст Lex.uz', reused:'Использован готовый результат — без новых расходов API', generated:'Создан новый ответ', saveAsDocument:'Сохранить как документ', aiSaved:'Ответ AI сохранен как документ задачи', taskUpdated:'Задача обновлена', someoneUpdated:'Другой участник только что обновил задачу. Показана последняя версия.', taskCreated:'Задача создана', taskDeleted:'Задача удалена', platinumTitle:'Создайте Platinum Workspace', platinumBody:'Workspace доступен только с активным тарифом Platinum. Он объединяет задачи, общую память AI и историю документов.', workspaceName:'Название Workspace', createWorkspace:'Создать Workspace', upgradePlatinum:'Посмотреть Platinum', noWorkspaceTitle:'Создайте Workspace для команды', noWorkspaceBody:'Вы станете Владельцем и сможете приглашать по username или email.', inviteMember:'Пригласить участника', emailOrUsername:'Email или username', role:'Роль', expires:'Срок действия', hours72:'72 часа', days7:'7 дней', days30:'30 дней', createInvite:'Создать ссылку', copyLink:'Копировать', copied:'Ссылка скопирована', pendingInvites:'Ожидающие приглашения', noPendingInvites:'Нет ожидающих приглашений.', readOnly:'Только чтение', readOnlyReason:'Platinum Владельца истек или у вас роль Наблюдателя.', error:'Ошибка', tryAgain:'Повторить', close:'Закрыть', required:'Обязательное поле', day:'День', week:'Неделя', month:'Месяц', quarter:'Квартал', timelineEmpty:'Задачи с датами появятся здесь.', timelineMobile:'Для удобной работы с лентой используйте компьютер.', shortcuts:'Горячие клавиши', shortcutNew:'Новая задача', shortcutSearch:'Поиск задач', shortcutHelp:'Окно помощи', confirmDeleteTask:'Удалить эту задачу?', uploadFailed:'Не удалось загрузить файл', uploadComplete:'Документ загружен', noAccess:'Нет доступа к Workspace', unauthorizedBody:'Примите приглашение или запросите доступ у Владельца.', updatedNow:'только что обновил(а)', unscheduled:'Без даты', taskDetails:'Детали задачи', morePeople:'еще', language:'Язык', workspaceError:'Не удалось загрузить Workspace', memberManagement:'Участники и роли', activePlanRequired:'Требуется активный Platinum', fileTooLarge:'Файл должен быть меньше 50 МБ', unsupportedFile:'Этот тип файла не поддерживается', aiThinking:'Проверяем память команды и правовые источники…', aiFailed:'Не удалось получить ответ AI', threadHistory:'История чата', newConversation:'Новый чат', taskLinkHint:'Ответ сохраняется вместе с задачей, документами и результатами команды.', previewNotice:'Безопасный UI preview — данные сервера не изменяются.'
        },
        en: {
            loading:'Loading Workspace…', workspace:'Workspace', sharedWork:'Shared legal work surface', newTask:'New task', invite:'Invite member', members:'Members', owner:'Owner', member:'Member', viewer:'Viewer', live:'Live', connecting:'Connecting', offline:'Offline', preview:'Preview', tasks:'Tasks', openTasks:'Open tasks', overdue:'Overdue', completed:'Completed', sharedMemory:'Shared AI memory', listView:'List', timelineView:'Timeline', searchTasks:'Search task or description', allStatuses:'All statuses', allPriorities:'All priorities', allAssignees:'All assignees', task:'Task', status:'Status', assignees:'Assignees', dueDate:'Due date', priority:'Priority', noTasksTitle:'Create the first shared task', noTasksBody:'Create a contract review or HR document task. People, documents and AI outputs stay together.', createTask:'Create task', editTask:'Edit task', title:'Title', description:'Description', startDate:'Start date', milestone:'Milestone', watchers:'Watchers', save:'Save', cancel:'Cancel', delete:'Delete', todo:'To do', in_progress:'In progress', in_review:'In review', done:'Done', cancelled:'Cancelled', low:'Low', normal:'Normal', high:'High', urgent:'Urgent', comments:'Comments', writeComment:'Write a comment…', send:'Send', noComments:'No comments yet. Share a decision or update here.', documents:'Documents', uploadDocument:'Upload document', noDocuments:'Attach a document or AI output to this task.', versions:'Versions', version:'version', download:'Download', activity:'Activity log', noActivity:'Changes will appear here in order.', aiAssistant:'Workspace AI', askAi:'Ask AI', askPlaceholder:'Ask with the task, documents and team memory in context…', aiContextTask:'Task context loaded', aiContextWorkspace:'Workspace memory and Lex.uz context', reused:'Existing validated result reused — no new API cost', generated:'New answer generated', saveAsDocument:'Save as document', aiSaved:'AI answer saved as a task document', taskUpdated:'Task updated', someoneUpdated:'Another member just updated this task. You are viewing the latest version.', taskCreated:'Task created', taskDeleted:'Task deleted', platinumTitle:'Create a Platinum Workspace', platinumBody:'Workspace requires an active Platinum plan. It combines team tasks, shared AI memory and document history.', workspaceName:'Workspace name', createWorkspace:'Create Workspace', upgradePlatinum:'View Platinum', noWorkspaceTitle:'Create a Workspace for your team', noWorkspaceBody:'You become Owner and can invite members by username or email.', inviteMember:'Invite member', emailOrUsername:'Email or username', role:'Role', expires:'Expiry', hours72:'72 hours', days7:'7 days', days30:'30 days', createInvite:'Create invite link', copyLink:'Copy', copied:'Link copied', pendingInvites:'Pending invitations', noPendingInvites:'No pending invitations.', readOnly:'Read only', readOnlyReason:'The Owner’s Platinum expired or your role is Viewer.', error:'Error', tryAgain:'Try again', close:'Close', required:'Required field', day:'Day', week:'Week', month:'Month', quarter:'Quarter', timelineEmpty:'Tasks with dates will appear here.', timelineMobile:'Use a desktop device to manage the timeline comfortably.', shortcuts:'Keyboard shortcuts', shortcutNew:'New task', shortcutSearch:'Search tasks', shortcutHelp:'Help overlay', confirmDeleteTask:'Delete this task?', uploadFailed:'Could not upload the file', uploadComplete:'Document uploaded', noAccess:'No Workspace access', unauthorizedBody:'Accept an invitation or ask the Owner for access.', updatedNow:'updated just now', unscheduled:'No date', taskDetails:'Task details', morePeople:'more', language:'Language', workspaceError:'Could not load Workspace', memberManagement:'Members and roles', activePlanRequired:'Active Platinum required', fileTooLarge:'File must be under 50 MB', unsupportedFile:'This file type is not supported', aiThinking:'Checking team memory and legal sources…', aiFailed:'Could not get an AI answer', threadHistory:'Conversation history', newConversation:'New conversation', taskLinkHint:'This answer stays with the task, its documents and team results.', previewNotice:'Safe UI preview — no server data is changed.'
        }
    };

    COPY.uz.onlinePeople = 'onlayn';
    COPY.uz.tokenUnit = 'token';
    COPY.uz.aiConclusion = 'AI xulosa';
    COPY.uz.nextSteps = 'Keyingi qadamni tanlang';
    COPY.uz.lexVerified = 'Lex.uz bilan tekshirildi';
    COPY.uz.copyAnswer = 'Javobni nusxalash';
    COPY.uz.answerCopied = 'Javob nusxalandi';
    COPY.uz.openMainAi = 'Hujjat yaratish oynasi ochildi';
    COPY.uz.downloadAnswer = 'Javobni Word formatida yuklash';
    COPY.uz.helpful = 'Foydali';
    COPY.uz.notHelpful = 'Foydali emas';
    COPY.uz.feedbackSaved = 'Rahmat! Fikringiz qayd etildi';
    COPY.uz.selectConversation = 'Suhbat tarixidan tanlang';
    COPY.uz.dateFormat = 'kk.oo.yyyy';
    COPY.uz.openCalendar = 'Kalendarni ochish';
    COPY.uz.previousMonth = 'Oldingi oy';
    COPY.uz.nextMonth = 'Keyingi oy';
    COPY.uz.today = 'Bugun';
    COPY.uz.clearDate = 'Tozalash';
    COPY.uz.invalidDate = 'Sanani kk.oo.yyyy formatida kiriting';
    COPY.ru.onlinePeople = 'онлайн';
    COPY.ru.tokenUnit = 'токен';
    COPY.ru.aiConclusion = 'AI-заключение';
    COPY.ru.nextSteps = 'Выберите следующий шаг';
    COPY.ru.lexVerified = 'Проверено по Lex.uz';
    COPY.ru.copyAnswer = 'Копировать ответ';
    COPY.ru.answerCopied = 'Ответ скопирован';
    COPY.ru.openMainAi = 'Открыта форма создания документа';
    COPY.ru.downloadAnswer = 'Скачать ответ в формате Word';
    COPY.ru.helpful = 'Полезно';
    COPY.ru.notHelpful = 'Не полезно';
    COPY.ru.feedbackSaved = 'Спасибо! Отзыв сохранен';
    COPY.ru.selectConversation = 'Выберите разговор из истории';
    COPY.ru.dateFormat = 'дд.мм.гггг';
    COPY.ru.openCalendar = 'Открыть календарь';
    COPY.ru.previousMonth = 'Предыдущий месяц';
    COPY.ru.nextMonth = 'Следующий месяц';
    COPY.ru.today = 'Сегодня';
    COPY.ru.clearDate = 'Очистить';
    COPY.ru.invalidDate = 'Введите дату в формате дд.мм.гггг';
    COPY.en.onlinePeople = 'online';
    COPY.en.tokenUnit = 'tokens';
    COPY.en.aiConclusion = 'AI conclusion';
    COPY.en.nextSteps = 'Choose the next step';
    COPY.en.lexVerified = 'Cross-checked with Lex.uz';
    COPY.en.copyAnswer = 'Copy answer';
    COPY.en.answerCopied = 'Answer copied';
    COPY.en.openMainAi = 'Document creation form opened';
    COPY.en.downloadAnswer = 'Download answer as Word';
    COPY.en.helpful = 'Helpful';
    COPY.en.notHelpful = 'Not helpful';
    COPY.en.feedbackSaved = 'Thank you! Feedback saved';
    COPY.en.selectConversation = 'Choose from conversation history';
    COPY.en.dateFormat = 'dd.mm.yyyy';
    COPY.en.openCalendar = 'Open calendar';
    COPY.en.previousMonth = 'Previous month';
    COPY.en.nextMonth = 'Next month';
    COPY.en.today = 'Today';
    COPY.en.clearDate = 'Clear';
    COPY.en.invalidDate = 'Enter the date as dd.mm.yyyy';

    Object.assign(COPY.uz, {
        graphView:'Grafik', teamChat:'Jamoa chati', sharedDocuments:'Umumiy hujjatlar',
        workspaceLockedTitle:'Workspace faqat Platinum yoki taklif qilingan faol a’zolar uchun',
        workspaceLockedBody:'Workspace’ni faollashtirish uchun Platinum a’zo bo‘lishingiz yoki Platinum a’zo tomonidan qo‘shilishingiz kerak.',
        minimumSilver:'Taklif qilingan a’zo Workspace’ga kirish uchun kamida faol Silver tarifiga ega bo‘lishi kerak.',
        expiredSubscription:'Obuna muddati tugagan', ownerExpired:'Workspace egasining Platinum obunasi tugagan. Workspace barcha a’zolar uchun vaqtincha yopildi.',
        memberExpired:'Obunangiz tugagan. Workspace’ni qayta ochish uchun kamida Silver tarifini faollashtiring.',
        shareTelegram:'Telegram orqali yuborish', copyInvite:'Havolani nusxalash', notifications:'Bildirishnomalar', noNotifications:'Hozircha yangi bildirishnoma yo‘q.',
        memberSubscriptionExpiredNotice:'A’zoning obunasi tugadi', memberSubscriptionExpiredMessage:'Workspace kirishi bloklandi. Tarif faollashtirilgach, kirish avtomatik tiklanadi.',
        chatEmpty:'Jamoa suhbatini boshlang. Muhim vazifani xabarga biriktirib qo‘yishingiz mumkin.',
        chatPlaceholder:'Jamoaga xabar yozing…', pinnedTask:'Biriktirilgan vazifa', noPinnedTask:'Vazifa biriktirilmagan',
        documentsEmpty:'Jamoa uchun birinchi umumiy hujjatni yuklang. Har bir yangi nusxa versiya sifatida saqlanadi.',
        graphEmpty:'Vazifalar yaratilgach, ular va ijrochilar orasidagi bog‘lanish shu yerda ko‘rinadi.',
        graphHint:'Tugunni bosing — vazifa yoki a’zo tafsilotlari ochiladi.', onTime:'Muddatida', approaching:'Muddat yaqin',
        memberProfile:'A’zo profili', activeTasks:'Faol vazifalar', sendMessage:'Xabar yuborish'
    });
    Object.assign(COPY.ru, {
        graphView:'График', teamChat:'Чат команды', sharedDocuments:'Общие документы', workspaceLockedTitle:'Workspace доступен Platinum или приглашённым активным участникам', workspaceLockedBody:'Чтобы активировать Workspace, оформите Platinum или примите приглашение участника Platinum.', minimumSilver:'Приглашённому участнику нужен активный тариф не ниже Silver.', expiredSubscription:'Подписка истекла', ownerExpired:'Platinum владельца истёк. Workspace временно закрыт для всей команды.', memberExpired:'Ваша подписка истекла. Для доступа нужен активный Silver или выше.', shareTelegram:'Отправить в Telegram', copyInvite:'Копировать ссылку', notifications:'Уведомления', noNotifications:'Новых уведомлений пока нет.', memberSubscriptionExpiredNotice:'Подписка участника истекла', memberSubscriptionExpiredMessage:'Доступ к Workspace заблокирован. После активации тарифа доступ восстановится автоматически.', chatEmpty:'Начните командный чат и при необходимости закрепите задачу.', chatPlaceholder:'Сообщение команде…', pinnedTask:'Закреплённая задача', noPinnedTask:'Без задачи', documentsEmpty:'Загрузите первый общий документ. Новые копии сохраняются как версии.', graphEmpty:'После создания задач здесь появятся связи между задачами и исполнителями.', graphHint:'Нажмите на узел, чтобы открыть задачу или профиль.', onTime:'В срок', approaching:'Срок близко', memberProfile:'Профиль участника', activeTasks:'Активные задачи', sendMessage:'Отправить'
    });
    Object.assign(COPY.en, {
        graphView:'Graph', teamChat:'Team chat', sharedDocuments:'Shared documents', workspaceLockedTitle:'Workspace is for Platinum or invited active members', workspaceLockedBody:'You must be a Platinum member to activate Workspace or be added by a Platinum member user.', minimumSilver:'An invited member needs an active Silver plan or higher.', expiredSubscription:'Expired subscription', ownerExpired:'The Owner’s Platinum plan expired. Workspace is temporarily unavailable to everyone.', memberExpired:'Your subscription expired. Activate Silver or higher to restore Workspace access.', shareTelegram:'Share via Telegram', copyInvite:'Copy link', notifications:'Notifications', noNotifications:'There are no new notifications yet.', memberSubscriptionExpiredNotice:'A member’s subscription expired', memberSubscriptionExpiredMessage:'Workspace access is blocked. It will be restored automatically after the plan is activated.', chatEmpty:'Start the team conversation and optionally pin a task.', chatPlaceholder:'Message your team…', pinnedTask:'Pinned task', noPinnedTask:'No pinned task', documentsEmpty:'Upload the first shared document. Every update is kept as a new version.', graphEmpty:'Task and assignee relationships will appear here after tasks are created.', graphHint:'Click a node to open the task or member profile.', onTime:'On time', approaching:'Due soon', memberProfile:'Member profile', activeTasks:'Active tasks', sendMessage:'Send'
    });

    var state = {
        language: localStorage.getItem('juristai-workspace-language') || 'uz',
        activated: false,
        loading: false,
        workspaces: [],
        workspace: null,
        role: null,
        isActive: false,
        counts: {},
        members: [],
        invitations: [],
        tasks: [],
        documents: [],
        activity: [],
        memory: [],
        threads: [],
        messages: [],
        notifications: [],
        currentTask: null,
        detail: null,
        view: 'list',
        timelineZoom: 'month',
        filters: { search: '', status: '', priority: '', assigneeId: '' },
        realtimeStatus: previewMode ? 'preview' : 'offline',
        supabase: null,
        realtimeChannel: null,
        bridge: null,
        presence: [],
        conflict: null,
        ai: { open: false, taskId: null, threadId: null, messages: [], loading: false, lastResult: null },
        modal: null,
        toastId: 0
    };

    function t(key) {
        var dict = COPY[state.language] || COPY.uz;
        return dict[key] || COPY.uz[key] || key;
    }

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    function svg(name, size) {
        return '<span class="ws-svg" style="width:' + (size || 18) + 'px;height:' + (size || 18) + 'px">' + (ICONS[name] || '') + '</span>';
    }

    function initials(person) {
        var value = (person && (person.fullName || person.full_name || person.username)) || '?';
        return value.split(/\s+/).filter(Boolean).slice(0, 2).map(function (part) { return part.charAt(0); }).join('').toUpperCase();
    }

    function personName(person) {
        return (person && (person.fullName || person.full_name || person.username)) || '—';
    }

    var CALENDAR_MONTHS = {
        uz: ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'],
        ru: ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'],
        en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    };

    var CALENDAR_WEEKDAYS = {
        uz: ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya'],
        ru: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'],
        en: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
    };

    function padDatePart(value) { return String(value).padStart(2, '0'); }

    function normalizeDateValue(value) {
        if (!value) return '';
        var raw = String(value);
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
        var parsed = new Date(raw);
        if (Number.isNaN(parsed.getTime())) return '';
        return parsed.getFullYear() + '-' + padDatePart(parsed.getMonth() + 1) + '-' + padDatePart(parsed.getDate());
    }

    function isoDate(value) {
        var normalized = normalizeDateValue(value);
        if (!normalized) return '';
        var parts = normalized.split('-');
        return parts[2] + '.' + parts[1] + '.' + parts[0];
    }

    function displayDateToIso(value) {
        var match = String(value || '').trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
        if (!match) return '';
        var day = Number(match[1]), month = Number(match[2]), year = Number(match[3]);
        var parsed = new Date(year, month - 1, day);
        if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return '';
        return year + '-' + padDatePart(month) + '-' + padDatePart(day);
    }

    function datePickerField(name, id, value, disabled) {
        var inputId = id || ('wsDate' + (++datePickerSerial));
        var normalized = normalizeDateValue(value);
        var disabledAttr = disabled ? ' disabled' : '';
        return '<div class="ws-date-picker" data-date-picker>' +
            '<input class="ws-date-value" type="hidden" name="' + esc(name) + '" value="' + esc(normalized) + '"' + disabledAttr + '>' +
            '<div class="ws-date-control">' +
                '<input class="ws-date-input" id="' + esc(inputId) + '" type="text" inputmode="numeric" autocomplete="off" maxlength="10" placeholder="' + esc(t('dateFormat')) + '" value="' + esc(isoDate(normalized)) + '" data-action="date-input" aria-haspopup="dialog"' + disabledAttr + '>' +
                '<button class="ws-date-toggle" type="button" data-action="date-toggle" aria-label="' + esc(t('openCalendar')) + '" aria-expanded="false"' + disabledAttr + '>' + svg('calendar', 18) + '</button>' +
            '</div>' +
            '<div class="ws-date-menu" role="dialog" aria-label="' + esc(t('openCalendar')) + '"></div>' +
        '</div>';
    }

    function syncDropdown(wrapper) {
        if (!wrapper) return;
        var select = wrapper.querySelector('select.ws-native-select');
        var trigger = wrapper.querySelector('.ws-dropdown-trigger');
        if (!select || !trigger) return;
        var selected = select.options[select.selectedIndex];
        var label = trigger.querySelector('.ws-dropdown-value');
        if (label) label.textContent = selected ? selected.textContent : '';
        trigger.disabled = select.disabled;
        wrapper.querySelectorAll('.ws-dropdown-option').forEach(function (optionButton) {
            var isSelected = String(optionButton.dataset.value) === String(select.value);
            optionButton.classList.toggle('selected', isSelected);
            optionButton.setAttribute('aria-selected', String(isSelected));
            optionButton.tabIndex = isSelected ? 0 : -1;
        });
    }

    function closeDropdowns(except) {
        if (!root) return;
        root.querySelectorAll('.ws-dropdown.open').forEach(function (wrapper) {
            if (wrapper === except) return;
            wrapper.classList.remove('open', 'drop-up');
            var trigger = wrapper.querySelector('.ws-dropdown-trigger');
            if (trigger) trigger.setAttribute('aria-expanded', 'false');
        });
    }

    function toggleDropdown(wrapper, forceOpen) {
        if (!wrapper) return;
        var trigger = wrapper.querySelector('.ws-dropdown-trigger');
        if (!trigger || trigger.disabled) return;
        var shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : !wrapper.classList.contains('open');
        closeDropdowns(shouldOpen ? wrapper : null);
        wrapper.classList.toggle('open', shouldOpen);
        trigger.setAttribute('aria-expanded', String(shouldOpen));
        wrapper.classList.remove('drop-up');
        if (shouldOpen) {
            global.requestAnimationFrame(function () {
                var menu = wrapper.querySelector('.ws-dropdown-menu');
                if (!menu) return;
                var bounds = wrapper.getBoundingClientRect();
                if (bounds.bottom + menu.offsetHeight + 12 > global.innerHeight && bounds.top > menu.offsetHeight + 20) wrapper.classList.add('drop-up');
            });
        }
    }

    function enhanceDropdowns(scope) {
        if (!scope) return;
        scope.querySelectorAll('select.ws-select:not([data-dropdown-enhanced])').forEach(function (select) {
            select.dataset.dropdownEnhanced = '1';
            var wrapper = document.createElement('div');
            wrapper.className = 'ws-dropdown';
            if (select.classList.contains('ws-workspace-select')) wrapper.classList.add('ws-workspace-dropdown');
            if (select.classList.contains('ws-language-select')) wrapper.classList.add('ws-language-dropdown');
            if (select.closest('.ws-filters')) wrapper.classList.add('ws-filter-dropdown');
            if (select.dataset.action === 'change-member-role') wrapper.classList.add('ws-member-role-dropdown', 'compact');

            var menuId = 'wsDropdownMenu' + (++dropdownSerial);
            var trigger = document.createElement('button');
            trigger.type = 'button';
            trigger.className = 'ws-dropdown-trigger';
            trigger.dataset.action = 'dropdown-toggle';
            trigger.setAttribute('aria-haspopup', 'listbox');
            trigger.setAttribute('aria-expanded', 'false');
            trigger.setAttribute('aria-controls', menuId);
            trigger.setAttribute('aria-label', select.getAttribute('aria-label') || (select.previousElementSibling && select.previousElementSibling.textContent) || '');
            trigger.innerHTML = '<span class="ws-dropdown-value"></span>' + svg('chevron', 16);

            var menu = document.createElement('div');
            menu.className = 'ws-dropdown-menu';
            menu.id = menuId;
            menu.setAttribute('role', 'listbox');
            menu.setAttribute('aria-label', trigger.getAttribute('aria-label'));
            Array.from(select.options).forEach(function (option) {
                var optionButton = document.createElement('button');
                optionButton.type = 'button';
                optionButton.className = 'ws-dropdown-option';
                optionButton.dataset.action = 'dropdown-option';
                optionButton.dataset.value = option.value;
                optionButton.setAttribute('role', 'option');
                optionButton.disabled = option.disabled;
                var optionLabel = document.createElement('span');
                optionLabel.className = 'ws-dropdown-option-label';
                optionLabel.textContent = option.textContent;
                var check = document.createElement('span');
                check.className = 'ws-dropdown-check';
                check.innerHTML = svg('check', 14);
                optionButton.appendChild(optionLabel);
                optionButton.appendChild(check);
                menu.appendChild(optionButton);
            });

            select.parentNode.insertBefore(wrapper, select);
            wrapper.appendChild(select);
            wrapper.appendChild(trigger);
            wrapper.appendChild(menu);
            select.classList.add('ws-native-select');
            select.tabIndex = -1;
            syncDropdown(wrapper);
        });
    }

    function closeDatePickers(except) {
        if (!root) return;
        root.querySelectorAll('.ws-date-picker.open').forEach(function (picker) {
            if (picker === except) return;
            picker.classList.remove('open', 'drop-up');
            var toggle = picker.querySelector('.ws-date-toggle');
            if (toggle) toggle.setAttribute('aria-expanded', 'false');
        });
    }

    function datePickerView(picker) {
        var selected = picker.querySelector('.ws-date-value').value;
        var view = picker.dataset.view;
        var source = /^\d{4}-\d{2}$/.test(view || '') ? view + '-01' : selected || normalizeDateValue(new Date().toISOString());
        var parts = source.split('-');
        return { year: Number(parts[0]), month: Number(parts[1]) - 1 };
    }

    function renderDatePicker(picker) {
        if (!picker) return;
        var menu = picker.querySelector('.ws-date-menu');
        var hidden = picker.querySelector('.ws-date-value');
        if (!menu || !hidden) return;
        var view = datePickerView(picker);
        picker.dataset.view = view.year + '-' + padDatePart(view.month + 1);
        var months = CALENDAR_MONTHS[state.language] || CALENDAR_MONTHS.uz;
        var weekdays = CALENDAR_WEEKDAYS[state.language] || CALENDAR_WEEKDAYS.uz;
        var firstOffset = (new Date(view.year, view.month, 1).getDay() + 6) % 7;
        var daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
        var today = normalizeDateValue(new Date().toISOString());
        var days = '';
        for (var blank = 0; blank < firstOffset; blank += 1) days += '<span class="ws-date-blank" aria-hidden="true"></span>';
        for (var day = 1; day <= daysInMonth; day += 1) {
            var value = view.year + '-' + padDatePart(view.month + 1) + '-' + padDatePart(day);
            var classes = 'ws-date-day' + (value === hidden.value ? ' selected' : '') + (value === today ? ' today' : '');
            days += '<button class="' + classes + '" type="button" data-action="date-day" data-date="' + value + '" aria-label="' + esc(isoDate(value)) + '" aria-pressed="' + String(value === hidden.value) + '">' + day + '</button>';
        }
        menu.innerHTML = '<div class="ws-date-head">' +
                '<button class="ws-date-nav previous" type="button" data-action="date-previous" aria-label="' + esc(t('previousMonth')) + '">' + svg('arrow', 17) + '</button>' +
                '<strong>' + esc(months[view.month] + ' ' + view.year) + '</strong>' +
                '<button class="ws-date-nav" type="button" data-action="date-next" aria-label="' + esc(t('nextMonth')) + '">' + svg('arrow', 17) + '</button>' +
            '</div>' +
            '<div class="ws-date-weekdays">' + weekdays.map(function (label) { return '<span>' + esc(label) + '</span>'; }).join('') + '</div>' +
            '<div class="ws-date-grid">' + days + '</div>' +
            '<div class="ws-date-footer"><button type="button" data-action="date-clear">' + esc(t('clearDate')) + '</button><button type="button" data-action="date-today">' + esc(t('today')) + '</button></div>';
    }

    function toggleDatePicker(picker, forceOpen) {
        if (!picker) return;
        var toggle = picker.querySelector('.ws-date-toggle');
        if (!toggle || toggle.disabled) return;
        var shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : !picker.classList.contains('open');
        closeDropdowns();
        closeDatePickers(shouldOpen ? picker : null);
        picker.classList.toggle('open', shouldOpen);
        toggle.setAttribute('aria-expanded', String(shouldOpen));
        picker.classList.remove('drop-up');
        if (!shouldOpen) return;
        renderDatePicker(picker);
        global.requestAnimationFrame(function () {
            var menu = picker.querySelector('.ws-date-menu');
            var bounds = picker.getBoundingClientRect();
            if (menu && bounds.bottom + menu.offsetHeight + 12 > global.innerHeight && bounds.top > menu.offsetHeight + 20) picker.classList.add('drop-up');
            if (menu && global.innerWidth <= 760) menu.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        });
    }

    function setDatePickerValue(picker, value) {
        if (!picker) return;
        var normalized = normalizeDateValue(value);
        var hidden = picker.querySelector('.ws-date-value');
        var input = picker.querySelector('.ws-date-input');
        if (!hidden || !input) return;
        hidden.value = normalized;
        input.value = isoDate(normalized);
        input.setCustomValidity('');
        input.setAttribute('aria-invalid', 'false');
        picker.dataset.view = normalized ? normalized.slice(0, 7) : '';
        hidden.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function changeDatePickerMonth(picker, delta) {
        var view = datePickerView(picker);
        var next = new Date(view.year, view.month + delta, 1);
        picker.dataset.view = next.getFullYear() + '-' + padDatePart(next.getMonth() + 1);
        renderDatePicker(picker);
    }

    function syncTypedDate(input, finalize) {
        if (!input) return;
        var picker = input.closest('.ws-date-picker');
        var hidden = picker && picker.querySelector('.ws-date-value');
        if (!picker || !hidden) return;
        var digits = input.value.replace(/\D/g, '').slice(0, 8);
        input.value = digits.slice(0, 2) + (digits.length > 2 ? '.' + digits.slice(2, 4) : '') + (digits.length > 4 ? '.' + digits.slice(4, 8) : '');
        var normalized = digits.length === 8 ? displayDateToIso(input.value) : '';
        hidden.value = normalized;
        var invalid = !!input.value && (!normalized && (finalize || digits.length === 8));
        input.setCustomValidity(invalid ? t('invalidDate') : '');
        input.setAttribute('aria-invalid', String(invalid));
        if (normalized) picker.dataset.view = normalized.slice(0, 7);
        if (picker.classList.contains('open')) renderDatePicker(picker);
    }

    function relativeTime(value) {
        if (!value) return '';
        var seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
        var locale = state.language === 'ru' ? 'ru' : state.language === 'en' ? 'en' : 'uz';
        var rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
        if (Math.abs(seconds) < 60) return rtf.format(seconds, 'second');
        var minutes = Math.round(seconds / 60);
        if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute');
        var hours = Math.round(minutes / 60);
        if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
        return rtf.format(Math.round(hours / 24), 'day');
    }

    function isOverdue(task) {
        return task && task.due_date && !['done', 'cancelled'].includes(task.status) && new Date(task.due_date + 'T23:59:59') < new Date();
    }

    function canWrite() {
        return !!state.workspace && state.isActive && (state.role === 'owner' || state.role === 'member');
    }

    function isOwner() { return state.role === 'owner'; }

    function currentPlan() {
        return String((currentUser && (currentUser.tariffPlan || currentUser.tariff_plan)) || '').toLowerCase();
    }

    function hasPlatinum() {
        var expiry=currentUser&&(currentUser.tariffExpiresAt||currentUser.tariff_expires_at);
        return currentPlan()==='platinum' && (!expiry || new Date(expiry).getTime()>=Date.now());
    }

    function debounceRefresh(callback, delay) {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(callback, delay || 220);
    }

    function formatBytes(value) {
        var bytes = Number(value || 0);
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1048576).toFixed(1) + ' MB';
    }

    function safeMarkdown(markdown) {
        var source = esc(markdown || '');
        source = source.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, function (_, label, url) {
            return '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
        });
        source = source.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        source = source.replace(/^###\s+(.+)$/gm, '<strong>$1</strong>');
        source = source.replace(/^[-•]\s+(.+)$/gm, '<span>• $1</span><br>');
        return source.split(/\n{2,}/).map(function (part) { return '<p>' + part.replace(/\n/g, '<br>') + '</p>'; }).join('');
    }

    function toast(message, tone) {
        var stack = document.querySelector('.ws-toast-stack');
        if (!stack) {
            stack = document.createElement('div');
            stack.className = 'ws-toast-stack';
            document.body.appendChild(stack);
        }
        var node = document.createElement('div');
        node.className = 'ws-toast ' + (tone || '');
        node.setAttribute('role', tone === 'error' ? 'alert' : 'status');
        node.textContent = message;
        stack.appendChild(node);
        setTimeout(function () { node.remove(); }, 4200);
    }

    function apiErrorMessage(error) {
        if (!error) return t('workspaceError');
        if (error.code === 'workspace_platinum_required') return t('activePlanRequired');
        return error.message || error.error || t('workspaceError');
    }

    var DEMO = (function buildDemoData() {
        var workspaceId = '10000000-0000-4000-8000-000000000001';
        var members = [
            { id: 9001, role: 'owner', username: 'bakhromski', full_name: 'Bakhrom Abdimuminov', email: 'bakhrom@juristai.uz', last_active_at: new Date().toISOString(), subscription_active:true, tariff_plan:'platinum' },
            { id: 9002, role: 'member', username: 'malika', full_name: 'Malika Karimova', email: 'malika@example.uz', last_active_at: new Date(Date.now() - 190000).toISOString(), subscription_active:true, tariff_plan:'silver' },
            { id: 9003, role: 'member', username: 'azizbek', full_name: 'Azizbek Namozov', email: 'azizbek@example.uz', last_active_at: new Date(Date.now() - 760000).toISOString(), subscription_active:true, tariff_plan:'gold' },
            { id: 9004, role: 'viewer', username: 'dilnoza', full_name: 'Dilnoza Tursunova', email: 'dilnoza@example.uz', last_active_at: new Date(Date.now() - 7200000).toISOString(), subscription_active:false, tariff_plan:'silver', tariff_expires_at:'2026-08-01' }
        ];
        var tasks = [
            { id:'20000000-0000-4000-8000-000000000001', workspace_id:workspaceId, title:'Xodimlar uchun yangi mehnat shartnomasini tekshirish', description:'HR jamoasi tayyorlagan shartnoma loyihasidagi xavfli bandlarni tekshirish va yakuniy tavsiya tayyorlash.', status:'in_progress', priority:'high', start_date:'2026-08-20', due_date:'2026-08-26', is_milestone:false, revision:4, updated_at:new Date(Date.now()-90000).toISOString(), assignees:[{id:9002,username:'malika',fullName:'Malika Karimova'},{id:9003,username:'azizbek',fullName:'Azizbek Namozov'}], watchers:[{id:9001,username:'bakhromski',fullName:'Bakhrom Abdimuminov'}], document_count:2, memory_count:1 },
            { id:'20000000-0000-4000-8000-000000000002', workspace_id:workspaceId, title:'Soliq tekshiruvi bo‘yicha javob xatini tayyorlash', description:'Dalolatnoma va birlamchi hujjatlar asosida javob xatini tayyorlash.', status:'in_review', priority:'urgent', start_date:'2026-08-18', due_date:'2026-08-22', is_milestone:false, revision:2, updated_at:new Date(Date.now()-7200000).toISOString(), assignees:[{id:9001,username:'bakhromski',fullName:'Bakhrom Abdimuminov'}], watchers:[{id:9002,username:'malika',fullName:'Malika Karimova'}], document_count:3, memory_count:2 },
            { id:'20000000-0000-4000-8000-000000000003', workspace_id:workspaceId, title:'Ijara shartnomasi bo‘yicha muzokara pozitsiyasi', description:'Yangi ofis ijara shartnomasi uchun muzokara qilinadigan bandlar ro‘yxati.', status:'todo', priority:'normal', start_date:'2026-08-27', due_date:'2026-09-04', is_milestone:false, revision:1, updated_at:new Date(Date.now()-86400000).toISOString(), assignees:[{id:9003,username:'azizbek',fullName:'Azizbek Namozov'}], watchers:[], document_count:1, memory_count:0 },
            { id:'20000000-0000-4000-8000-000000000004', workspace_id:workspaceId, title:'Direktorlar kengashi qarorini tasdiqlash', description:'Qaror loyihasi va ilovalarni yakuniy tekshirish.', status:'todo', priority:'high', start_date:'2026-09-07', due_date:'2026-09-07', is_milestone:true, revision:1, updated_at:new Date(Date.now()-172800000).toISOString(), assignees:[{id:9001,username:'bakhromski',fullName:'Bakhrom Abdimuminov'}], watchers:[{id:9004,username:'dilnoza',fullName:'Dilnoza Tursunova'}], document_count:0, memory_count:0 },
            { id:'20000000-0000-4000-8000-000000000005', workspace_id:workspaceId, title:'Xodimning talabnomasiga javob berish', description:'Ish haqi bo‘yicha talabnomaga asoslantirilgan javob.', status:'done', priority:'normal', start_date:'2026-08-11', due_date:'2026-08-15', is_milestone:false, revision:5, updated_at:new Date(Date.now()-259200000).toISOString(), assignees:[{id:9002,username:'malika',fullName:'Malika Karimova'}], watchers:[], document_count:2, memory_count:1 }
        ];
        var comments = {};
        comments[tasks[0].id] = [
            { id:'30000000-0000-4000-8000-000000000001', author_id:9002, full_name:'Malika Karimova', username:'malika', body:'Shartnomaning raqobatni cheklash bandini alohida belgiladim.', created_at:new Date(Date.now()-4200000).toISOString() },
            { id:'30000000-0000-4000-8000-000000000002', author_id:9001, full_name:'Bakhrom Abdimuminov', username:'bakhromski', body:'Rahmat. AI xulosasini ham shu vazifaga saqlaymiz.', created_at:new Date(Date.now()-3100000).toISOString() }
        ];
        var documents = [
            { id:'40000000-0000-4000-8000-000000000001', workspace_id:workspaceId, origin_task_id:tasks[0].id, title:'Mehnat shartnomasi — tahlil qilinadigan nusxa.docx', kind:'upload', latest_version_id:'41000000-0000-4000-8000-000000000001', version_number:2, version_created_at:new Date(Date.now()-4400000).toISOString(), files:[{id:'f1',format:'docx',path:workspaceId+'/40000000-0000-4000-8000-000000000001/41000000-0000-4000-8000-000000000001/mehnat-shartnomasi.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',byteSize:58420}] },
            { id:'40000000-0000-4000-8000-000000000002', workspace_id:workspaceId, origin_task_id:tasks[0].id, title:'AI huquqiy xulosa', kind:'generated', latest_version_id:'41000000-0000-4000-8000-000000000002', version_number:1, version_created_at:new Date(Date.now()-2500000).toISOString(), files:[] }
        ];
        var activity = [
            { id:'a1', task_id:tasks[0].id, action:'task.updated', full_name:'Malika Karimova', username:'malika', task_title:tasks[0].title, created_at:new Date(Date.now()-90000).toISOString() },
            { id:'a2', task_id:tasks[0].id, action:'comment.created', full_name:'Bakhrom Abdimuminov', username:'bakhromski', task_title:tasks[0].title, created_at:new Date(Date.now()-3100000).toISOString() },
            { id:'a3', task_id:tasks[0].id, action:'document.attached', full_name:'Malika Karimova', username:'malika', task_title:tasks[0].title, created_at:new Date(Date.now()-4400000).toISOString() }
        ];
        return {
            workspace:{ id:workspaceId, name:'Abdimuminov Legal Team', slug:'abdimuminov-legal-team', default_language:'uz', owner_id:9001, role:'owner', is_active:true, member_count:members.length, task_count:tasks.length },
            members:members, tasks:tasks, comments:comments, documents:documents, activity:activity, threads:[], aiMessages:{},
            messages:[{id:'msg1',body:'Mehnat shartnomasi bo‘yicha yakuniy tekshiruvni bugun qilamiz.',author_id:9002,full_name:'Malika Karimova',username:'malika',pinned_task_id:tasks[0].id,pinned_task_title:tasks[0].title,created_at:new Date(Date.now()-3600000).toISOString()}],
            notifications:[],
            invitations:[{id:'inv1',invitee_username:'yangi-yurist',role:'member',status:'pending',expires_at:new Date(Date.now()+604800000).toISOString()}]
        };
    })();

    function clone(value) { return JSON.parse(JSON.stringify(value)); }

    async function previewApi(method, path, body) {
        await new Promise(function (resolve) { setTimeout(resolve, 120); });
        var workspaceId = DEMO.workspace.id;
        if (method === 'GET' && path === '/workspaces') return { workspaces:[clone(DEMO.workspace)] };
        if (method === 'POST' && path === '/workspaces') {
            DEMO.workspace.name = body.name;
            return { workspace:clone(DEMO.workspace), role:'owner', isActive:true };
        }
        if (method === 'GET' && path === '/workspaces/' + workspaceId) return { workspace:clone(DEMO.workspace), counts:{members:DEMO.members.length,tasks:DEMO.tasks.length,documents:DEMO.documents.length,memory_items:4} };
        if (method === 'GET' && path === '/workspaces/' + workspaceId + '/members') return { members:clone(DEMO.members), currentRole:'owner' };
        if (method === 'GET' && path === '/workspaces/' + workspaceId + '/invitations') return { invitations:clone(DEMO.invitations) };
        if (method === 'POST' && path === '/workspaces/' + workspaceId + '/invitations') {
            var invitation = {id:'inv'+Date.now(),role:body.role,status:'pending',expires_at:new Date(Date.now()+Number(body.expiresInHours||72)*3600000).toISOString()};
            if (String(body.email||'').includes('@')) invitation.invitee_email=body.email; else invitation.invitee_username=body.username;
            DEMO.invitations.unshift(invitation);
            var inviteUrl=global.location.origin+'/workspace-invite/'+invitation.id+'-preview';
            return { invitation:clone(invitation), inviteUrl:inviteUrl, telegramShareUrl:'https://t.me/share/url?url='+encodeURIComponent(inviteUrl) };
        }
        if (method === 'PATCH' && /\/members\/\d+$/.test(path)) {
            var memberId = Number(path.split('/').pop());
            var member = DEMO.members.find(function (item) { return item.id === memberId; });
            if (member) member.role = body.role;
            return { member:clone(member) };
        }
        if (method === 'GET' && (path.indexOf('/tasks?') > -1 || path.indexOf('/timeline?') > -1)) {
            var query = new URLSearchParams(path.split('?')[1] || '');
            var items = DEMO.tasks.filter(function (task) {
                return (!query.get('status') || task.status === query.get('status')) &&
                    (!query.get('priority') || task.priority === query.get('priority')) &&
                    (!query.get('assigneeId') || task.assignees.some(function (person) { return String(person.id) === query.get('assigneeId'); })) &&
                    (!query.get('search') || (task.title+' '+task.description).toLowerCase().includes(query.get('search').toLowerCase()));
            });
            return { items:clone(items), limit:200, offset:0, zoomLevels:['day','week','month','quarter'] };
        }
        var taskDetailMatch = path.match(new RegExp('^/workspaces/'+workspaceId+'/tasks/([^/?]+)$'));
        if (method === 'GET' && taskDetailMatch) {
            var detailTask = DEMO.tasks.find(function (task) { return task.id === taskDetailMatch[1]; });
            if (!detailTask) throw {status:404,code:'task_not_found',message:'Vazifa topilmadi'};
            return { task:clone(detailTask), assignees:clone(detailTask.assignees), watchers:clone(detailTask.watchers), comments:clone(DEMO.comments[detailTask.id]||[]), links:[], documents:clone(DEMO.documents.filter(function (doc) { return doc.origin_task_id === detailTask.id; })), memory:[], activity:clone(DEMO.activity.filter(function (item) { return item.task_id === detailTask.id; })) };
        }
        if (method === 'POST' && path === '/workspaces/' + workspaceId + '/tasks') {
            var created = {id:crypto.randomUUID(),workspace_id:workspaceId,title:body.title,description:body.description||'',status:body.status||'todo',priority:body.priority||'normal',start_date:body.startDate||null,due_date:body.dueDate||null,is_milestone:!!body.isMilestone,revision:1,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),assignees:DEMO.members.filter(function (m){return (body.assigneeIds||[]).includes(m.id);}).map(function(m){return{id:m.id,username:m.username,fullName:m.full_name};}),watchers:[],document_count:0,memory_count:0};
            DEMO.tasks.unshift(created); DEMO.comments[created.id]=[];
            return {task:clone(created)};
        }
        if (method === 'PATCH' && taskDetailMatch) {
            var updated = DEMO.tasks.find(function (task) { return task.id === taskDetailMatch[1]; });
            var mapping = {startDate:'start_date',dueDate:'due_date',isMilestone:'is_milestone'};
            Object.keys(body||{}).forEach(function(key){ if(key!=='clientRevision') updated[mapping[key]||key]=body[key]; });
            updated.revision+=1; updated.updated_at=new Date().toISOString();
            return {task:clone(updated)};
        }
        if (method === 'DELETE' && taskDetailMatch) {
            DEMO.tasks = DEMO.tasks.filter(function(task){return task.id!==taskDetailMatch[1];}); return null;
        }
        var peopleMatch = path.match(new RegExp('^/workspaces/'+workspaceId+'/tasks/([^/]+)/(assignees|watchers)$'));
        if (method === 'PUT' && peopleMatch) {
            var peopleTask=DEMO.tasks.find(function(task){return task.id===peopleMatch[1];});
            peopleTask[peopleMatch[2]]=DEMO.members.filter(function(m){return body.userIds.includes(m.id);}).map(function(m){return{id:m.id,username:m.username,fullName:m.full_name};});
            return {userIds:body.userIds};
        }
        var commentMatch = path.match(new RegExp('^/workspaces/'+workspaceId+'/tasks/([^/]+)/comments$'));
        if (method === 'POST' && commentMatch) {
            var comment={id:crypto.randomUUID(),task_id:commentMatch[1],author_id:9001,full_name:'Bakhrom Abdimuminov',username:'bakhromski',body:body.body,created_at:new Date().toISOString()};
            (DEMO.comments[commentMatch[1]]||(DEMO.comments[commentMatch[1]]=[])).push(comment); return {comment:clone(comment)};
        }
        if (method === 'GET' && path === '/workspaces/' + workspaceId + '/documents') return {documents:clone(DEMO.documents)};
        if (method === 'GET' && path === '/workspaces/' + workspaceId + '/messages') return {messages:clone(DEMO.messages)};
        if (method === 'POST' && path === '/workspaces/' + workspaceId + '/messages') {
            var chatMessage={id:crypto.randomUUID(),body:body.body,author_id:9001,full_name:'Bakhrom Abdimuminov',username:'bakhromski',pinned_task_id:body.pinnedTaskId||null,pinned_task_title:(DEMO.tasks.find(function(task){return task.id===body.pinnedTaskId;})||{}).title||null,created_at:new Date().toISOString()};
            DEMO.messages.push(chatMessage);return{message:clone(chatMessage)};
        }
        if (method === 'GET' && path === '/workspaces/' + workspaceId + '/notifications') return {notifications:clone(DEMO.notifications)};
        if (method === 'POST' && path === '/workspaces/' + workspaceId + '/documents') {
            var document={id:crypto.randomUUID(),workspace_id:workspaceId,origin_task_id:body.taskId||null,title:body.title,kind:body.kind||'upload',version_number:1,latest_version_id:crypto.randomUUID(),version_created_at:new Date().toISOString(),files:[]};
            DEMO.documents.unshift(document);
            var taskForDoc=DEMO.tasks.find(function(task){return task.id===body.taskId;}); if(taskForDoc) taskForDoc.document_count+=1;
            return {document:clone(document),version:{id:document.latest_version_id,version_number:1,content_text:body.contentText||null},storagePathPrefix:workspaceId+'/'+document.id+'/'+document.latest_version_id+'/'};
        }
        if (method === 'GET' && /\/documents\/[^/]+\/versions$/.test(path)) {
            var docId=path.split('/').slice(-2)[0], doc=DEMO.documents.find(function(item){return item.id===docId;});
            return {versions:[{id:doc.latest_version_id,version_number:doc.version_number||1,created_at:doc.version_created_at,files:doc.files||[]}]};
        }
        if (method === 'POST' && /\/versions\/[^/]+\/files$/.test(path)) {
            var targetDocId=path.split('/')[4], targetDoc=DEMO.documents.find(function(item){return item.id===targetDocId;});
            targetDoc.files=[{id:crypto.randomUUID(),format:body.fileFormat,path:body.objectPath,mimeType:body.mimeType,byteSize:body.byteSize}]; return {file:clone(targetDoc.files[0])};
        }
        if (method === 'GET' && path === '/workspaces/' + workspaceId + '/activity?limit=100') return {activity:clone(DEMO.activity)};
        if (method === 'GET' && path === '/workspaces/' + workspaceId + '/memory') return {memory:[{id:'m1',kind:'answer'},{id:'m2',kind:'research'},{id:'m3',kind:'answer'},{id:'m4',kind:'document'}]};
        if (method === 'GET' && path === '/workspaces/' + workspaceId + '/assistant/threads') return {threads:clone(DEMO.threads)};
        var previewThreadMatch=path.match(new RegExp('^/workspaces/'+workspaceId+'/assistant/threads/([^/]+)$'));
        if(method==='GET'&&previewThreadMatch){var previewThread=DEMO.threads.find(function(thread){return thread.id===previewThreadMatch[1];});if(!previewThread)throw{status:404,code:'thread_not_found',message:'AI suhbati topilmadi'};return{thread:clone(previewThread),messages:clone(DEMO.aiMessages[previewThread.id]||[])};}
        if (method === 'POST' && path === '/workspaces/' + workspaceId + '/assistant/ask') {
            var previewResponse={status:'succeeded',reused:body.question.toLowerCase().includes('oldingi'),runId:crypto.randomUUID(),threadId:body.threadId||crypto.randomUUID(),memoryItemId:crypto.randomUUID(),provider:'gpt-5.6-luna',model:'gpt-5.6-luna',databases:['Workspace xotirasi','Korpus','Lex.uz'],ragUsed:true,rag:{lexCrossCheck:{status:'verified',checked:2}},reply:'**Huquqiy asos**\n\nBu javob vazifadagi hujjatlar, jamoaning oldingi tahlili va Lex.uz manbalari asosida tayyorlandi. Xodim bilan tuziladigan shartnomadagi cheklovlar mutanosib, aniq muddatli va qonuniy manfaat bilan bog‘langan bo‘lishi kerak.\n\n**Tahlil**\n\n[Mehnat kodeksi, O‘RQ-798, tegishli modda](https://lex.uz/uz/docs/-6257288) talablarini shartnoma bandlari bilan solishtiring.\n\n**Xulosa**\n\nAvval shartnoma shartlarini yozma talab bilan aniqlashtiring.',usage:{inTokens:body.question.toLowerCase().includes('oldingi')?0:1280,outTokens:body.question.toLowerCase().includes('oldingi')?0:420,costUsd:body.question.toLowerCase().includes('oldingi')?0:0.0017},nextActions:[{id:'document_demand',kind:'document',label:'Ish beruvchiga yozma talabnoma',documentType:'Talabnoma',inputFields:[{key:'recipient',label:'Talabnoma yuboriladigan tashkilot',type:'text',placeholder:'Tashkilotning to‘liq nomi',required:true},{key:'obligation',label:'Muhim shartlar va tafsilotlar',type:'textarea',placeholder:'Bajarilmagan majburiyat, muhim sanalar va dalillarni yozing',required:true}]},{id:'document_claim',kind:'document',label:'Mehnat nizosi bo‘yicha da’vo arizasi',documentType:'Da’vo arizasi',inputFields:[]},{id:'attorney_directory',kind:'attorney',label:'Soha bo‘yicha advokat topish'}]};
            var demoThread=DEMO.threads.find(function(thread){return thread.id===previewResponse.threadId;});
            if(!demoThread){demoThread={id:previewResponse.threadId,task_id:body.taskId||null,title:body.question,updated_at:new Date().toISOString(),message_count:0};DEMO.threads.unshift(demoThread);DEMO.aiMessages[demoThread.id]=[];}
            DEMO.aiMessages[demoThread.id].push({id:crypto.randomUUID(),role:'user',content:body.question,created_at:new Date().toISOString()},{id:crypto.randomUUID(),role:'assistant',content:previewResponse.reply,result:previewResponse,created_at:new Date().toISOString()});demoThread.message_count=DEMO.aiMessages[demoThread.id].length;demoThread.updated_at=new Date().toISOString();
            return previewResponse;
        }
        if (method === 'POST' && path === '/workspace-realtime/token') return {preview:true};
        throw {status:404,code:'preview_route_not_found',message:'Preview route not found: '+method+' '+path};
    }

    async function api(method, path, body) {
        if (previewMode) return previewApi(method, path, body);
        var options = { method:method, headers:{'Accept':'application/json'} };
        if (body !== undefined) {
            options.headers['Content-Type']='application/json';
            options.body=JSON.stringify(body);
        }
        var response = await fetch('/api'+path, options);
        if (response.status === 204) return null;
        var payload = await response.json().catch(function(){return {};});
        if (!response.ok) {
            var error = new Error(payload.message || payload.error || ('HTTP '+response.status));
            error.status=response.status; error.code=payload.code || payload.errorCode; error.payload=payload;
            throw error;
        }
        return payload;
    }

    function render() {
        if (!root) root = document.getElementById('workspaceApp');
        if (!root) return;
        if (state.loading && !state.activated) {
            root.innerHTML='<div class="workspace-boot"><span class="workspace-spinner" aria-hidden="true"></span><span>'+esc(t('loading'))+'</span></div>';
            return;
        }
        if (!state.workspace) {
            root.innerHTML=renderWorkspaceGate()+renderModal()+renderToastsAnchor();
            return;
        }
        var open = state.tasks.filter(function(task){return !['done','cancelled'].includes(task.status);}).length;
        var overdue = state.tasks.filter(isOverdue).length;
        var complete = state.tasks.filter(function(task){return task.status==='done';}).length;
        var unreadNotifications=(state.notifications||[]).filter(function(item){return !item.read_at;}).length;
        root.innerHTML = '<div class="ws-shell">'+
            '<header class="ws-topbar">'+
                '<div class="ws-topbar-main">'+
                    '<div><p class="ws-kicker">JURISTAI '+esc(t('workspace'))+'</p><div class="ws-title-row">'+
                        '<select class="ws-select ws-workspace-select" data-action="switch-workspace" aria-label="'+esc(t('workspace'))+'">'+state.workspaces.map(function(item){return '<option value="'+esc(item.id)+'" '+(item.id===state.workspace.id?'selected':'')+'>'+esc(item.name)+'</option>';}).join('')+'</select>'+
                        '<span class="ws-role-badge">'+esc(t(state.role||'viewer'))+'</span></div>'+
                        '<p class="ws-subtitle">'+esc(t('sharedWork'))+'</p></div>'+
                '</div>'+
                '<div class="ws-topbar-actions">'+
                    '<span class="ws-live-badge '+esc(state.realtimeStatus)+'">'+esc(t(state.realtimeStatus==='online'?'live':state.realtimeStatus==='connecting'?'connecting':state.realtimeStatus==='preview'?'preview':'offline'))+'</span>'+
                    '<select class="ws-select ws-language-select" data-action="language" aria-label="'+esc(t('language'))+'"><option value="uz" '+(state.language==='uz'?'selected':'')+'>UZ</option><option value="ru" '+(state.language==='ru'?'selected':'')+'>RU</option><option value="en" '+(state.language==='en'?'selected':'')+'>EN</option></select>'+
                    '<button class="ws-btn" type="button" data-action="open-chat">'+svg('chat')+'<span>'+esc(t('teamChat'))+'</span></button>'+
                    '<button class="ws-btn" type="button" data-action="open-shared-documents">'+svg('document')+'<span>'+esc(t('sharedDocuments'))+'</span></button>'+
                    '<button class="ws-btn" type="button" data-action="open-members">'+svg('members')+'<span>'+esc(t('members'))+'</span></button>'+
                    '<button class="ws-btn icon ghost ws-notification-button" type="button" data-action="open-notifications" aria-label="'+esc(t('notifications'))+'" title="'+esc(t('notifications'))+'">'+svg('history')+(unreadNotifications?'<span class="ws-notification-count">'+unreadNotifications+'</span>':'')+'</button>'+
                    '<button class="ws-btn" type="button" data-action="open-ai">'+svg('ai')+'<span>'+esc(t('aiAssistant'))+'</span></button>'+
                    '<button class="ws-btn primary" type="button" data-action="new-task" '+(!canWrite()?'disabled':'')+'>'+svg('add')+'<span>'+esc(t('newTask'))+'</span></button>'+
                    '<button class="ws-btn icon ghost" type="button" data-action="shortcuts" aria-label="'+esc(t('shortcuts'))+'">'+svg('help')+'</button>'+
                '</div>'+
            '</header>'+
            (previewMode?'<div class="ws-conflict">'+svg('help',16)+esc(t('previewNotice'))+'</div>':'')+
            (!canWrite()?'<div class="ws-conflict">'+svg('history',16)+'<div><strong>'+esc(t('readOnly'))+'</strong> — '+esc(t('readOnlyReason'))+'</div></div>':'')+
            '<section class="ws-summary" aria-label="'+esc(t('workspace'))+'">'+
                renderMetric('list',t('openTasks'),open)+renderMetric('calendar',t('overdue'),overdue)+renderMetric('check',t('completed'),complete)+renderMetric('ai',t('sharedMemory'),Number(state.counts.memory_items||state.memory.length||0))+
            '</section>'+
            '<div class="ws-toolbar">'+
                '<div class="ws-view-tabs" role="tablist" aria-label="'+esc(t('tasks'))+'">'+
                    '<button class="ws-view-tab '+(state.view==='list'?'active':'')+'" type="button" role="tab" aria-selected="'+(state.view==='list')+'" data-action="view-list">'+svg('list',15)+esc(t('listView'))+'</button>'+
                    '<button class="ws-view-tab '+(state.view==='timeline'?'active':'')+'" type="button" role="tab" aria-selected="'+(state.view==='timeline')+'" data-action="view-timeline">'+svg('timeline',15)+esc(t('timelineView'))+'</button>'+
                    '<button class="ws-view-tab '+(state.view==='graph'?'active':'')+'" type="button" role="tab" aria-selected="'+(state.view==='graph')+'" data-action="view-graph">'+svg('graph',15)+esc(t('graphView'))+'</button>'+
                '</div>'+
                renderFilters()+
            '</div>'+
            (state.view==='timeline'?renderTimeline():state.view==='graph'?renderGraph():renderTaskList())+
        '</div>'+renderTaskDetail()+renderAiPanel()+renderModal()+renderToastsAnchor();
        enhanceDropdowns(root);
    }

    function renderToastsAnchor() { return ''; }

    function renderWorkspaceGate() {
        var platinum = state.workspaceGate === 'platinum';
        var locked = state.workspaceGate === 'locked' || state.workspaceGate === 'owner-expired' || state.workspaceGate === 'member-expired';
        var lockedBody=state.workspaceGate==='owner-expired'?t('ownerExpired'):state.workspaceGate==='member-expired'?t('memberExpired'):t('workspaceLockedBody');
        return '<div class="ws-gate"><section class="ws-gate-card">'+
            '<div class="ws-gate-mark">'+svg(locked?'lock':platinum?'ai':'members',26)+'</div>'+
            '<p class="ws-kicker">JURISTAI WORKSPACE</p>'+
            '<h2>'+esc(locked?t('workspaceLockedTitle'):t(platinum?'platinumTitle':'noWorkspaceTitle'))+'</h2>'+
            '<p>'+esc(locked?lockedBody:t(platinum?'platinumBody':'noWorkspaceBody'))+'</p>'+
            (!locked?'<form class="ws-create-form" data-form="create-workspace">'+
                '<label class="ws-sr-only" for="wsCreateName">'+esc(t('workspaceName'))+'</label>'+
                '<input class="ws-input" id="wsCreateName" name="name" required minlength="2" maxlength="120" placeholder="'+esc(t('workspaceName'))+'">'+
                '<button class="ws-btn primary" type="submit">'+svg('add')+esc(t('createWorkspace'))+'</button>'+
            '</form>':'')+
            ((platinum||locked)?'<a class="ws-btn ghost" style="margin-top:12px;text-decoration:none" href="/tariff.html">'+esc(t('upgradePlatinum'))+'</a>':'')+
        '</section></div>';
    }

    function renderMetric(icon, label, value) {
        return '<article class="ws-metric"><div class="ws-metric-top"><span>'+esc(label)+'</span><span class="ws-metric-icon">'+svg(icon,18)+'</span></div><strong class="ws-metric-value">'+esc(value)+'</strong></article>';
    }

    function renderFilters() {
        return '<div class="ws-filters">'+
            '<label class="ws-search-wrap">'+svg('search',17)+'<span class="ws-sr-only">'+esc(t('searchTasks'))+'</span><input class="ws-input" data-filter="search" value="'+esc(state.filters.search)+'" placeholder="'+esc(t('searchTasks'))+'"></label>'+
            '<select class="ws-select" data-filter="status" aria-label="'+esc(t('status'))+'"><option value="">'+esc(t('allStatuses'))+'</option>'+['todo','in_progress','in_review','done','cancelled'].map(function(item){return '<option value="'+item+'" '+(state.filters.status===item?'selected':'')+'>'+esc(t(item))+'</option>';}).join('')+'</select>'+
            '<select class="ws-select" data-filter="priority" aria-label="'+esc(t('priority'))+'"><option value="">'+esc(t('allPriorities'))+'</option>'+['low','normal','high','urgent'].map(function(item){return '<option value="'+item+'" '+(state.filters.priority===item?'selected':'')+'>'+esc(t(item))+'</option>';}).join('')+'</select>'+
            '<select class="ws-select" data-filter="assigneeId" aria-label="'+esc(t('assignees'))+'"><option value="">'+esc(t('allAssignees'))+'</option>'+state.members.map(function(member){return '<option value="'+member.id+'" '+(String(state.filters.assigneeId)===String(member.id)?'selected':'')+'>'+esc(personName(member))+'</option>';}).join('')+'</select>'+
        '</div>';
    }

    function renderTaskList() {
        if (!state.tasks.length) {
            return '<section class="ws-panel ws-empty"><div class="ws-empty-icon">'+svg('list',25)+'</div><h3>'+esc(t('noTasksTitle'))+'</h3><p>'+esc(t('noTasksBody'))+'</p><button class="ws-btn primary" type="button" data-action="new-task" '+(!canWrite()?'disabled':'')+'>'+svg('add')+esc(t('createTask'))+'</button></section>';
        }
        return '<section class="ws-panel"><div class="ws-list-head"><span>'+esc(t('task'))+'</span><span>'+esc(t('status'))+'</span><span>'+esc(t('assignees'))+'</span><span>'+esc(t('dueDate'))+'</span><span></span></div>'+state.tasks.map(renderTaskRow).join('')+'</section>';
    }

    function graphTone(task) {
        if (task.status==='done') return 'done';
        if (isOverdue(task)) return 'overdue';
        if (task.priority==='urgent') return 'approaching';
        if (task.due_date) {
            var days=Math.ceil((new Date(task.due_date+'T23:59:59').getTime()-Date.now())/86400000);
            if(days>=0&&days<=3)return 'approaching';
        }
        return 'active';
    }

    function renderGraph() {
        if (!state.tasks.length) return '<section class="ws-panel ws-empty"><div class="ws-empty-icon">'+svg('graph',25)+'</div><h3>'+esc(t('graphView'))+'</h3><p>'+esc(t('graphEmpty'))+'</p></section>';
        var width=Math.max(980,Math.min(2400,980+Math.ceil(state.tasks.length/3)*95));
        var taskPositions={},memberPositions={};
        state.members.forEach(function(member,index){memberPositions[String(member.id)]={x:110+index*150,y:82};});
        state.tasks.forEach(function(task,index){taskPositions[task.id]={x:90+(index%5)*205,y:220+Math.floor(index/5)*145};});
        var height=Math.max(520,340+Math.ceil(state.tasks.length/5)*145);
        var edges=[];
        state.tasks.forEach(function(task){
            var from=taskPositions[task.id];
            (task.assignees||[]).slice(0,4).forEach(function(member){
                var to=memberPositions[String(member.id)];
                if(to)edges.push('<path d="M '+(from.x+76)+' '+(from.y-26)+' C '+(from.x+76)+' '+(from.y-86)+', '+(to.x+34)+' '+(to.y+70)+', '+(to.x+34)+' '+(to.y+38)+'"/>');
            });
        });
        var memberNodes=state.members.map(function(member){var p=memberPositions[String(member.id)],expired=member.subscription_active===false;return '<button type="button" class="ws-graph-member '+(expired?'expired':'')+'" style="left:'+p.x+'px;top:'+p.y+'px" data-action="open-member-profile" data-member-id="'+esc(member.id)+'" title="'+esc(personName(member))+'"><span class="ws-avatar">'+esc(initials(member))+'</span><span>'+esc(personName(member))+'</span>'+(expired?'<small>'+esc(t('expiredSubscription'))+'</small>':'')+'</button>';}).join('');
        var taskNodes=state.tasks.map(function(task){var p=taskPositions[task.id],tone=graphTone(task);return '<button type="button" class="ws-graph-task '+tone+'" style="left:'+p.x+'px;top:'+p.y+'px" data-action="open-task" data-task-id="'+esc(task.id)+'" title="'+esc(task.title)+'"><strong>'+esc(task.title)+'</strong><span>'+esc(t(task.status))+' · '+esc(task.due_date?isoDate(task.due_date):t('unscheduled'))+'</span><span class="ws-graph-badges">'+(task.is_milestone?'<b>'+esc(t('milestone'))+'</b>':'')+(Number(task.document_count||0)?'<b>'+svg('document',12)+Number(task.document_count)+'</b>':'')+'</span></button>';}).join('');
        return '<section class="ws-panel ws-graph"><div class="ws-graph-toolbar"><span>'+esc(t('graphHint'))+'</span><span class="ws-graph-legend"><i class="done"></i>'+esc(t('onTime'))+' <i class="approaching"></i>'+esc(t('approaching'))+' <i class="overdue"></i>'+esc(t('overdue'))+'</span></div><div class="ws-graph-scroll"><div class="ws-graph-stage" style="width:'+width+'px;height:'+height+'px"><svg viewBox="0 0 '+width+' '+height+'" preserveAspectRatio="none" aria-hidden="true">'+edges.join('')+'</svg>'+memberNodes+taskNodes+'</div></div></section>';
    }

    function renderTaskRow(task) {
        return '<button class="ws-task-row" type="button" data-action="open-task" data-task-id="'+esc(task.id)+'">'+
            '<div class="ws-task-main"><span class="ws-priority-line '+esc(task.priority)+'"></span><div style="min-width:0"><p class="ws-task-title">'+esc(task.title)+'</p><div class="ws-task-meta">'+(task.is_milestone?'<span class="ws-pill">'+esc(t('milestone'))+'</span>':'')+'<span>'+esc(t(task.priority))+'</span><span class="ws-task-counts">'+svg('document',13)+Number(task.document_count||0)+' · '+svg('ai',13)+Number(task.memory_count||0)+'</span></div></div></div>'+
            '<span class="ws-status '+esc(task.status)+'">'+esc(t(task.status))+'</span>'+
            renderAvatars(task.assignees||[])+
            '<time class="ws-due '+(isOverdue(task)?'overdue':'')+'" datetime="'+esc(task.due_date||'')+'">'+esc(task.due_date?isoDate(task.due_date):t('unscheduled'))+'</time>'+
            '<span>'+svg('arrow',17)+'</span>'+
        '</button>';
    }

    function renderAvatars(people) {
        var visible=(people||[]).slice(0,3);
        return '<span class="ws-avatars" aria-label="'+esc(t('assignees'))+'">'+visible.map(function(person){return '<span class="ws-avatar" title="'+esc(personName(person))+'">'+esc(initials(person))+'</span>';}).join('')+((people||[]).length>3?'<span class="ws-avatar more">+'+((people||[]).length-3)+'</span>':'')+'</span>';
    }

    function timelineRange() {
        var dated=state.tasks.filter(function(task){return task.start_date||task.due_date;});
        var now=new Date(); now.setHours(0,0,0,0);
        var dates=[now.getTime()];
        dated.forEach(function(task){if(task.start_date)dates.push(new Date(task.start_date+'T00:00:00').getTime());if(task.due_date)dates.push(new Date(task.due_date+'T00:00:00').getTime());});
        var padding=state.timelineZoom==='day'?1:state.timelineZoom==='week'?4:state.timelineZoom==='quarter'?20:10;
        return {min:Math.min.apply(Math,dates)-padding*86400000,max:Math.max.apply(Math,dates)+padding*86400000};
    }

    function renderTimeline() {
        var dated=state.tasks.filter(function(task){return task.start_date||task.due_date;});
        var range=timelineRange(), span=Math.max(86400000,range.max-range.min);
        var tickCount=state.timelineZoom==='day'?8:6;
        var ticks=[]; for(var i=0;i<tickCount;i++){var ratio=i/(tickCount-1);var ts=range.min+(span*ratio);ticks.push('<span class="ws-timeline-tick" style="left:'+(ratio*100)+'%">'+esc(isoDate(new Date(ts).toISOString()))+'</span>');}
        return '<section class="ws-panel ws-timeline"><div class="ws-timeline-toolbar"><span class="ws-help ws-timeline-hint">'+esc(t('timelineMobile'))+'</span><div class="ws-view-tabs">'+['day','week','month','quarter'].map(function(zoom){return '<button class="ws-view-tab '+(state.timelineZoom===zoom?'active':'')+'" type="button" data-action="timeline-zoom" data-zoom="'+zoom+'">'+esc(t(zoom))+'</button>';}).join('')+'</div></div>'+
            (dated.length?'<div class="ws-timeline-stage"><div class="ws-timeline-scale">'+ticks.join('')+'</div>'+dated.map(function(task){return renderTimelineRow(task,range,span);}).join('')+'</div>':'<div class="ws-empty"><div class="ws-empty-icon">'+svg('timeline',24)+'</div><h3>'+esc(t('timelineEmpty'))+'</h3></div>')+'</section>';
    }

    function renderTimelineRow(task,range,span) {
        var start=new Date((task.start_date||task.due_date)+'T00:00:00').getTime();
        var end=new Date((task.due_date||task.start_date)+'T00:00:00').getTime();
        var left=Math.max(0,Math.min(100,(start-range.min)/span*100));
        var width=Math.max(1.8,Math.min(100-left,(Math.max(end,start)-start+86400000)/span*100));
        var marker=task.is_milestone?'<span class="ws-timeline-milestone" data-action="open-task" data-task-id="'+esc(task.id)+'" style="left:calc('+left+'% - 9px)" title="'+esc(task.title)+'"></span>':'<span class="ws-timeline-bar '+(isOverdue(task)?'overdue':'')+'" data-task-id="'+esc(task.id)+'" data-start="'+esc(task.start_date||task.due_date)+'" data-due="'+esc(task.due_date||task.start_date)+'" style="left:'+left+'%;width:'+width+'%" title="'+esc(task.title)+'"></span>';
        return '<div class="ws-timeline-row"><button class="ws-timeline-label ws-btn ghost" type="button" data-action="open-task" data-task-id="'+esc(task.id)+'" title="'+esc(task.title)+'"><span class="ws-timeline-label-text">'+esc(task.title)+'</span></button><div class="ws-timeline-track">'+marker+'</div></div>';
    }

    function renderTaskDetail() {
        if (!state.currentTask || !state.detail) return '';
        var task=state.detail.task;
        var disabled=canWrite()?'':'disabled';
        return '<div class="ws-detail-backdrop" data-action="close-detail" aria-hidden="true"></div>'+
            '<aside class="ws-detail-panel" role="dialog" aria-modal="true" aria-labelledby="wsDetailTitle">'+
                '<header class="ws-detail-header"><div><p class="ws-kicker">'+esc(t('taskDetails'))+'</p><h2 id="wsDetailTitle">'+esc(task.title)+'</h2><div class="ws-presence">'+renderAvatars(state.presence)+'<span>'+esc(state.presence.length?state.presence.length+' '+t('onlinePeople'):relativeTime(task.updated_at))+'</span></div></div><div class="ws-inline" style="gap:7px"><button class="ws-btn small" type="button" data-action="open-ai" data-task-id="'+esc(task.id)+'">'+svg('ai',14)+esc(t('askAi'))+'</button><button class="ws-btn icon ghost" type="button" data-action="close-detail" aria-label="'+esc(t('close'))+'">'+svg('close')+'</button></div></header>'+
                '<div class="ws-detail-body">'+
                    (state.conflict?'<div class="ws-conflict">'+svg('history',16)+esc(t('someoneUpdated'))+'</div>':'')+
                    '<form data-form="update-task">'+
                        '<div class="ws-detail-grid">'+
                            '<div class="ws-field full"><label for="wsDetailTitleInput">'+esc(t('title'))+'</label><input class="ws-input" id="wsDetailTitleInput" name="title" value="'+esc(task.title)+'" maxlength="240" required '+disabled+'></div>'+
                            '<div class="ws-field full"><label for="wsDetailDescription">'+esc(t('description'))+'</label><textarea class="ws-textarea" id="wsDetailDescription" name="description" maxlength="50000" '+disabled+'>'+esc(task.description||'')+'</textarea></div>'+
                            '<div class="ws-field"><label for="wsDetailStatus">'+esc(t('status'))+'</label><select class="ws-select" id="wsDetailStatus" name="status" '+disabled+'>'+['todo','in_progress','in_review','done','cancelled'].map(function(item){return '<option value="'+item+'" '+(task.status===item?'selected':'')+'>'+esc(t(item))+'</option>';}).join('')+'</select></div>'+
                            '<div class="ws-field"><label for="wsDetailPriority">'+esc(t('priority'))+'</label><select class="ws-select" id="wsDetailPriority" name="priority" '+disabled+'>'+['low','normal','high','urgent'].map(function(item){return '<option value="'+item+'" '+(task.priority===item?'selected':'')+'>'+esc(t(item))+'</option>';}).join('')+'</select></div>'+
                            '<div class="ws-field"><label for="wsDetailStartDate">'+esc(t('startDate'))+'</label>'+datePickerField('startDate','wsDetailStartDate',task.start_date||'',!!disabled)+'</div>'+
                            '<div class="ws-field"><label for="wsDetailDueDate">'+esc(t('dueDate'))+'</label>'+datePickerField('dueDate','wsDetailDueDate',task.due_date||'',!!disabled)+'</div>'+
                            '<label class="ws-person-chip '+(task.is_milestone?'selected':'')+'"><input type="checkbox" name="isMilestone" '+(task.is_milestone?'checked':'')+' '+disabled+'>'+esc(t('milestone'))+'</label>'+
                        '</div>'+
                        '<section class="ws-section"><div class="ws-section-head"><h3>'+esc(t('assignees'))+'</h3></div>'+renderPeoplePicker('assigneeIds',state.detail.assignees||[],disabled)+'</section>'+
                        '<section class="ws-section"><div class="ws-section-head"><h3>'+esc(t('watchers'))+'</h3></div>'+renderPeoplePicker('watcherIds',state.detail.watchers||[],disabled)+'</section>'+
                        (canWrite()?'<div class="ws-save-bar"><button class="ws-btn danger" type="button" data-action="delete-task">'+esc(t('delete'))+'</button><button class="ws-btn primary" type="submit">'+esc(t('save'))+'</button></div>':'')+
                    '</form>'+
                    renderDocumentsSection()+renderCommentsSection()+renderActivitySection()+
                '</div>'+
            '</aside>';
    }

    function renderPeoplePicker(name, selected, disabled) {
        var selectedIds=(selected||[]).map(function(person){return Number(person.id);});
        return '<div class="ws-people-picker">'+state.members.map(function(person){var active=selectedIds.includes(Number(person.id));return '<label class="ws-person-chip '+(active?'selected':'')+'"><input class="ws-sr-only" type="checkbox" name="'+name+'" value="'+person.id+'" '+(active?'checked':'')+' '+disabled+'><span class="ws-avatar" style="width:22px;height:22px;margin:0;border-width:1px">'+esc(initials(person))+'</span>'+esc(personName(person))+'</label>';}).join('')+'</div>';
    }

    function renderDocumentsSection() {
        var docs=state.detail.documents||[];
        return '<section class="ws-section"><div class="ws-section-head"><div><h3>'+esc(t('documents'))+'</h3><span class="ws-help">'+esc(t('taskLinkHint'))+'</span></div>'+ (canWrite()?'<label class="ws-btn small" for="wsDocumentUpload">'+svg('upload',14)+esc(t('uploadDocument'))+'</label><input class="ws-file-input" id="wsDocumentUpload" type="file" data-action="upload-document" accept=".pdf,.docx,.rtf,.txt,.jpg,.jpeg,.png">':'')+'</div>'+
            (docs.length?docs.map(function(doc){return '<article class="ws-document"><div><div class="ws-document-title">'+esc(doc.title)+'</div><div class="ws-document-meta">v'+Number(doc.version_number||1)+' · '+esc(isoDate(doc.version_created_at||doc.updated_at))+'</div></div><div class="ws-inline" style="gap:6px"><button class="ws-btn small" type="button" data-action="versions" data-document-id="'+esc(doc.id)+'">'+svg('history',14)+esc(t('versions'))+'</button>'+((doc.files||[]).length?'<button class="ws-btn icon small" type="button" data-action="download-file" data-path="'+esc(doc.files[0].path||doc.files[0].storage_object_path)+'" aria-label="'+esc(t('download'))+'">'+svg('download',14)+'</button>':'')+'</div></article>';}).join(''):'<p class="ws-help">'+esc(t('noDocuments'))+'</p>')+
        '</section>';
    }

    function renderCommentsSection() {
        var comments=state.detail.comments||[];
        return '<section class="ws-section"><div class="ws-section-head"><h3>'+esc(t('comments'))+'</h3><span class="ws-pill">'+comments.length+'</span></div>'+
            (comments.length?comments.map(function(comment){return '<article class="ws-comment"><span class="ws-avatar" style="margin:0">'+esc(initials(comment))+'</span><div><div class="ws-comment-head"><strong>'+esc(personName(comment))+'</strong><time>'+esc(relativeTime(comment.created_at))+'</time></div><div class="ws-comment-body">'+esc(comment.body)+'</div></div></article>';}).join(''):'<p class="ws-help">'+esc(t('noComments'))+'</p>')+
            (canWrite()?'<form class="ws-comment-form" data-form="comment"><label class="ws-sr-only" for="wsCommentInput">'+esc(t('writeComment'))+'</label><input class="ws-input" id="wsCommentInput" name="body" required maxlength="20000" placeholder="'+esc(t('writeComment'))+'"><button class="ws-btn primary" type="submit">'+svg('send',14)+esc(t('send'))+'</button></form>':'')+
        '</section>';
    }

    function activityLabel(item) {
        var labels={
            'task.created':state.language==='ru'?'создал(а) задачу':state.language==='en'?'created the task':'vazifani yaratdi',
            'task.updated':state.language==='ru'?'обновил(а) задачу':state.language==='en'?'updated the task':'vazifani yangiladi',
            'comment.created':state.language==='ru'?'добавил(а) комментарий':state.language==='en'?'added a comment':'izoh qo‘shdi',
            'document.attached':state.language==='ru'?'прикрепил(а) документ':state.language==='en'?'attached a document':'hujjat biriktirdi'
        };
        return labels[item.action]||String(item.action||'').replace(/[._]/g,' ');
    }

    function renderActivitySection() {
        var activity=state.detail.activity||[];
        return '<section class="ws-section"><div class="ws-section-head"><h3>'+esc(t('activity'))+'</h3></div>'+ (activity.length?activity.map(function(item){return '<div class="ws-activity-item"><strong style="color:var(--ws-ink-soft)">'+esc(personName(item))+'</strong> '+esc(activityLabel(item))+'<div>'+esc(relativeTime(item.created_at))+'</div></div>';}).join(''):'<p class="ws-help">'+esc(t('noActivity'))+'</p>')+'</section>';
    }

    function renderAiPanel() {
        if (!state.ai.open) return '';
        var contextTask=state.ai.taskId && state.tasks.find(function(task){return task.id===state.ai.taskId;});
        var availableThreads=(state.threads||[]).filter(function(thread){return (thread.task_id||null)===(state.ai.taskId||null);});
        var historySelect=availableThreads.length?'<select class="ws-select ws-ai-history-select" data-action="ai-thread" aria-label="'+esc(t('threadHistory'))+'"><option value="">'+esc(t('selectConversation'))+'</option>'+availableThreads.map(function(thread){return '<option value="'+esc(thread.id)+'" '+(thread.id===state.ai.threadId?'selected':'')+'>'+esc(thread.title||t('newConversation'))+'</option>';}).join('')+'</select>':'<span class="ws-help">'+esc(t('threadHistory'))+': 0</span>';
        return '<div class="ws-ai-backdrop" data-action="close-ai" aria-hidden="true"></div><aside class="ws-ai-panel" role="dialog" aria-modal="true" aria-labelledby="wsAiTitle">'+
            '<header class="ws-detail-header"><div><p class="ws-kicker">JURISTAI</p><h2 id="wsAiTitle">'+esc(t('aiAssistant'))+'</h2></div><button class="ws-btn icon ghost" type="button" data-action="close-ai" aria-label="'+esc(t('close'))+'">'+svg('close')+'</button></header>'+
            '<div class="ws-ai-context">'+svg(contextTask?'list':'ai',15)+'<strong>'+esc(contextTask?contextTask.title:t('aiContextWorkspace'))+'</strong><span>· '+esc(contextTask?t('aiContextTask'):t('sharedMemory'))+'</span></div>'+
            '<div class="ws-ai-toolbar">'+historySelect+'<button class="ws-btn small" type="button" data-action="new-ai-conversation">'+svg('add',14)+esc(t('newConversation'))+'</button></div>'+
            '<div class="ws-ai-messages" id="wsAiMessages">'+(state.ai.messages.length?state.ai.messages.map(renderAiMessage).join(''):'<div class="ws-empty"><div class="ws-empty-icon">'+svg('ai',24)+'</div><h3>'+esc(t('askAi'))+'</h3><p>'+esc(t('taskLinkHint'))+'</p></div>')+(state.ai.loading?'<div class="ws-ai-message assistant"><span class="workspace-spinner" style="display:inline-block;width:14px;height:14px;margin-right:8px"></span>'+esc(t('aiThinking'))+'</div>':'')+'</div>'+
            '<form class="ws-ai-composer" data-form="ai"><div class="ws-ai-composer-inner"><label class="ws-sr-only" for="wsAiInput">'+esc(t('askPlaceholder'))+'</label><textarea id="wsAiInput" name="question" rows="1" required minlength="3" maxlength="20000" placeholder="'+esc(t('askPlaceholder'))+'" '+(canWrite()?'':'disabled')+'></textarea><button class="ws-btn primary icon" type="submit" '+(state.ai.loading||!canWrite()?'disabled':'')+' aria-label="'+esc(t('send'))+'">'+svg('send')+'</button></div></form>'+
        '</aside>';
    }

    function renderAiMessage(message, messageIndex) {
        if (message.role==='user') return '<div class="ws-ai-message user">'+esc(message.content)+'</div>';
        var result=message.result||{};
        var lexCheck=result.rag&&result.rag.lexCrossCheck;
        var checked=lexCheck&&['verified','revised','approved'].includes(String(lexCheck.status||'').toLowerCase());
        var nextActions=Array.isArray(result.nextActions)?result.nextActions.slice(0,3):[];
        var nextHtml=nextActions.length?'<div class="ws-ai-next"><strong>'+esc(t('nextSteps'))+'</strong><div class="ws-ai-next-grid">'+nextActions.map(function(action,actionIndex){return '<button type="button" class="ws-ai-next-action" data-action="workspace-ai-next-action" data-message-index="'+messageIndex+'" data-next-index="'+actionIndex+'">'+esc(action.label||t('nextSteps'))+'</button>';}).join('')+'</div></div>':'';
        var controls='<div class="ws-ai-answer-controls"><button class="ws-btn icon ghost small" type="button" data-action="copy-ai-answer" data-message-index="'+messageIndex+'" aria-label="'+esc(t('copyAnswer'))+'" title="'+esc(t('copyAnswer'))+'">'+svg('copy',14)+'</button><button class="ws-btn icon ghost small" type="button" data-action="download-ai-answer" data-message-index="'+messageIndex+'" aria-label="'+esc(t('downloadAnswer'))+'" title="'+esc(t('downloadAnswer'))+'">'+svg('download',14)+'</button><button class="ws-btn icon ghost small '+(result.userRating==='good'?'selected':'')+'" type="button" data-action="rate-ai-answer" data-message-index="'+messageIndex+'" data-rating="good" aria-label="'+esc(t('helpful'))+'" title="'+esc(t('helpful'))+'" '+(result.userRating?'disabled':'')+'>'+svg('thumbUp',14)+'</button><button class="ws-btn icon ghost small '+(result.userRating==='bad'?'selected':'')+'" type="button" data-action="rate-ai-answer" data-message-index="'+messageIndex+'" data-rating="bad" aria-label="'+esc(t('notHelpful'))+'" title="'+esc(t('notHelpful'))+'" '+(result.userRating?'disabled':'')+'>'+svg('thumbDown',14)+'</button>'+(state.ai.taskId&&result.runId?'<button class="ws-btn small" type="button" data-action="save-ai-document" data-run-id="'+esc(result.runId)+'">'+svg('document',14)+esc(t('saveAsDocument'))+'</button>':'')+'</div>';
        return '<div class="ws-ai-message assistant">'+safeMarkdown(message.content)+nextHtml+'<div class="ws-ai-meta">'+(result.reused?'<span class="ws-ai-reuse">'+svg('check',12)+esc(t('reused'))+'</span>':'<span>'+esc(t('generated'))+'</span>')+(checked?'<span class="ws-ai-verified">'+svg('check',12)+esc(t('lexVerified'))+'</span>':'')+(result.usage?'<span>'+Number(result.usage.inTokens||0)+' / '+Number(result.usage.outTokens||0)+' '+esc(t('tokenUnit'))+'</span>':'')+'</div>'+controls+'</div>';
    }

    function renderModal() {
        if (!state.modal) return '';
        if (state.modal==='task') return renderTaskModal();
        if (state.modal==='members') return renderMembersModal();
        if (state.modal==='chat') return renderChatModal();
        if (state.modal==='shared-documents') return renderSharedDocumentsModal();
        if (state.modal==='member-profile') return renderMemberProfileModal();
        if (state.modal==='versions') return renderVersionsModal();
        if (state.modal==='notifications') return renderNotificationsModal();
        if (state.modal==='shortcuts') return renderShortcutsModal();
        return '';
    }

    function modalFrame(title, body, actions) {
        return '<div class="ws-modal-backdrop" data-action="close-modal"><section class="ws-modal-card" role="dialog" aria-modal="true" aria-label="'+esc(title)+'"><header class="ws-modal-header"><h2>'+esc(title)+'</h2><button class="ws-btn icon ghost" type="button" data-action="close-modal" aria-label="'+esc(t('close'))+'">'+svg('close')+'</button></header><div class="ws-modal-body">'+body+'</div>'+(actions?'<footer class="ws-modal-actions">'+actions+'</footer>':'')+'</section></div>';
    }

    function renderTaskModal() {
        var draft=state.modalData||{};
        var body='<form id="wsCreateTaskForm" data-form="create-task"><div class="ws-detail-grid">'+
            '<div class="ws-field full"><label>'+esc(t('title'))+'</label><input class="ws-input" name="title" required maxlength="240" value="'+esc(draft.title||'')+'"></div>'+
            '<div class="ws-field full"><label>'+esc(t('description'))+'</label><textarea class="ws-textarea" name="description" maxlength="50000">'+esc(draft.description||'')+'</textarea></div>'+
            '<div class="ws-field"><label>'+esc(t('status'))+'</label><select class="ws-select" name="status">'+['todo','in_progress','in_review'].map(function(item){return '<option value="'+item+'">'+esc(t(item))+'</option>';}).join('')+'</select></div>'+
            '<div class="ws-field"><label>'+esc(t('priority'))+'</label><select class="ws-select" name="priority">'+['low','normal','high','urgent'].map(function(item){return '<option value="'+item+'" '+(item==='normal'?'selected':'')+'>'+esc(t(item))+'</option>';}).join('')+'</select></div>'+
            '<div class="ws-field"><label for="wsCreateStartDate">'+esc(t('startDate'))+'</label>'+datePickerField('startDate','wsCreateStartDate','',false)+'</div>'+
            '<div class="ws-field"><label for="wsCreateDueDate">'+esc(t('dueDate'))+'</label>'+datePickerField('dueDate','wsCreateDueDate','',false)+'</div>'+
            '<div class="ws-field full"><label>'+esc(t('assignees'))+'</label>'+renderPeoplePicker('assigneeIds',[], '')+'</div>'+
            '<label class="ws-person-chip"><input type="checkbox" name="isMilestone">'+esc(t('milestone'))+'</label>'+
        '</div></form>';
        return modalFrame(t('createTask'),body,'<button class="ws-btn" type="button" data-action="close-modal">'+esc(t('cancel'))+'</button><button class="ws-btn primary" type="submit" form="wsCreateTaskForm">'+esc(t('createTask'))+'</button>');
    }

    function renderMembersModal() {
        var inviteResult=state.inviteUrl?'<div class="ws-invite-output"><strong>'+esc(t('invite'))+'</strong><p class="ws-help">'+esc(t('minimumSilver'))+'</p><div class="ws-invite-link"><input class="ws-input" readonly value="'+esc(state.inviteUrl)+'"><button class="ws-btn" type="button" data-action="copy-invite">'+esc(t('copyInvite'))+'</button></div><a class="ws-btn primary ws-telegram-share" target="_blank" rel="noopener" href="'+esc(state.telegramShareUrl||('https://t.me/share/url?url='+encodeURIComponent(state.inviteUrl)))+'">'+svg('send',14)+esc(t('shareTelegram'))+'</a></div>':'';
        var inviteForm=isOwner()?'<section class="ws-section" style="margin-top:0;padding-top:0;border-top:0"><div class="ws-section-head"><h3>'+esc(t('inviteMember'))+'</h3></div><form data-form="invite"><div class="ws-detail-grid"><div class="ws-field full"><label>'+esc(t('emailOrUsername'))+'</label><input class="ws-input" name="target" required></div><div class="ws-field"><label>'+esc(t('role'))+'</label><select class="ws-select" name="role"><option value="member">'+esc(t('member'))+'</option><option value="viewer">'+esc(t('viewer'))+'</option></select></div><div class="ws-field"><label>'+esc(t('expires'))+'</label><select class="ws-select" name="expiresInHours"><option value="72">'+esc(t('hours72'))+'</option><option value="168">'+esc(t('days7'))+'</option><option value="720">'+esc(t('days30'))+'</option></select></div></div><button class="ws-btn primary" style="margin-top:12px" type="submit">'+esc(t('createInvite'))+'</button></form>'+inviteResult+'</section>':'';
        var members='<section class="ws-section"><div class="ws-section-head"><h3>'+esc(t('memberManagement'))+'</h3><span class="ws-pill">'+state.members.length+'</span></div>'+state.members.map(function(person){var expired=person.subscription_active===false;return '<div class="ws-document ws-member-row '+(expired?'expired':'')+'"><button class="ws-inline ws-member-identity ws-link-button" type="button" data-action="open-member-profile" data-member-id="'+esc(person.id)+'"><span class="ws-avatar" style="margin:0">'+esc(initials(person))+'</span><div class="ws-member-copy"><div class="ws-document-title">'+esc(personName(person))+'</div><div class="ws-document-meta">@'+esc(person.username||'')+(expired?' · <strong>'+esc(t('expiredSubscription'))+'</strong>':'')+'</div></div></button>'+(isOwner()&&person.role!=='owner'?'<select class="ws-select" style="width:120px;min-height:36px" data-action="change-member-role" data-member-id="'+person.id+'" '+(expired?'disabled':'')+'><option value="member" '+(person.role==='member'?'selected':'')+'>'+esc(t('member'))+'</option><option value="viewer" '+(person.role==='viewer'?'selected':'')+'>'+esc(t('viewer'))+'</option></select>':'<span class="ws-role-badge">'+esc(t(person.role))+'</span>')+'</div>';}).join('')+'</section>';
        var pendingInvitations=(state.invitations||[]).filter(function(inv){return inv.status==='pending';});
        var invites=isOwner()?'<section class="ws-section"><div class="ws-section-head"><h3>'+esc(t('pendingInvites'))+'</h3></div>'+(pendingInvitations.length?pendingInvitations.map(function(inv){return '<div class="ws-document"><div><div class="ws-document-title">'+esc(inv.invitee_email||('@'+inv.invitee_username))+'</div><div class="ws-document-meta">'+esc(t(inv.role))+' · '+esc(isoDate(inv.expires_at))+'</div></div></div>';}).join(''):'<p class="ws-help">'+esc(t('noPendingInvites'))+'</p>')+'</section>':'';
        return modalFrame(t('members'),inviteForm+members+invites,'');
    }

    function renderChatModal() {
        var messages=state.messages||[];
        var body='<div class="ws-chat-list">'+(messages.length?messages.map(function(message){return '<article class="ws-chat-message"><span class="ws-avatar">'+esc(initials(message))+'</span><div><div class="ws-comment-head"><strong>'+esc(personName(message))+'</strong><time>'+esc(relativeTime(message.created_at))+'</time></div><div class="ws-comment-body">'+esc(message.body)+'</div>'+(message.pinned_task_id?'<button class="ws-pinned-task" type="button" data-action="open-task-from-modal" data-task-id="'+esc(message.pinned_task_id)+'">'+svg('list',13)+esc(message.pinned_task_title||t('pinnedTask'))+'</button>':'')+'</div></article>';}).join(''):'<div class="ws-empty compact"><p>'+esc(t('chatEmpty'))+'</p></div>')+'</div>'+
            (canWrite()?'<form class="ws-chat-form" data-form="workspace-message"><textarea class="ws-textarea" name="body" required maxlength="4000" placeholder="'+esc(t('chatPlaceholder'))+'"></textarea><select class="ws-select" name="pinnedTaskId"><option value="">'+esc(t('noPinnedTask'))+'</option>'+state.tasks.map(function(task){return '<option value="'+esc(task.id)+'">'+esc(task.title)+'</option>';}).join('')+'</select><button class="ws-btn primary" type="submit">'+svg('send',14)+esc(t('sendMessage'))+'</button></form>':'');
        return modalFrame(t('teamChat'),body,'');
    }

    function renderSharedDocumentsModal() {
        var docs=state.documents||[];
        var body=(canWrite()?'<label class="ws-shared-upload" for="wsSharedDocumentUpload">'+svg('upload',22)+'<strong>'+esc(t('uploadDocument'))+'</strong><span>'+esc(t('documentsEmpty'))+'</span></label><input class="ws-file-input" id="wsSharedDocumentUpload" type="file" data-action="upload-shared-document" accept=".pdf,.docx,.rtf,.txt,.jpg,.jpeg,.png">':'')+
            '<div class="ws-shared-doc-list">'+(docs.length?docs.map(function(doc){return '<article class="ws-document"><div><div class="ws-document-title">'+esc(doc.title)+'</div><div class="ws-document-meta">v'+Number(doc.version_number||1)+' · '+esc(isoDate(doc.version_created_at||doc.updated_at||doc.created_at))+(doc.origin_task_id?' · '+esc(t('task')):'')+'</div></div><button class="ws-btn small" type="button" data-action="versions" data-document-id="'+esc(doc.id)+'">'+svg('history',14)+esc(t('versions'))+'</button></article>';}).join(''):'<div class="ws-empty compact"><p>'+esc(t('documentsEmpty'))+'</p></div>')+'</div>';
        return modalFrame(t('sharedDocuments'),body,'');
    }

    function renderMemberProfileModal() {
        var person=state.modalData&&state.modalData.member;
        if(!person)return '';
        var tasks=state.tasks.filter(function(task){return !['done','cancelled'].includes(task.status)&&(task.assignees||[]).some(function(member){return String(member.id)===String(person.id);});});
        var body='<div class="ws-member-profile"><span class="ws-avatar large">'+esc(initials(person))+'</span><h3>'+esc(personName(person))+'</h3><p>@'+esc(person.username||'')+' · '+esc(t(person.role||'member'))+'</p>'+(person.subscription_active===false?'<div class="ws-expired-banner">'+esc(t('expiredSubscription'))+'</div>':'')+'<div class="ws-section"><div class="ws-section-head"><h3>'+esc(t('activeTasks'))+'</h3><span class="ws-pill">'+tasks.length+'</span></div>'+tasks.map(function(task){return '<button class="ws-profile-task" type="button" data-action="open-task-from-modal" data-task-id="'+esc(task.id)+'"><span class="ws-status '+esc(task.status)+'">'+esc(t(task.status))+'</span><strong>'+esc(task.title)+'</strong></button>';}).join('')+'</div></div>';
        return modalFrame(t('memberProfile'),body,'');
    }

    function renderVersionsModal() {
        var data=state.modalData||{}, versions=data.versions||[];
        var body=versions.length?versions.map(function(version){return '<article class="ws-document"><div><div class="ws-document-title">v'+Number(version.version_number||1)+'</div><div class="ws-document-meta">'+esc(isoDate(version.created_at))+'</div></div><div class="ws-inline" style="gap:6px">'+(version.files||[]).map(function(file){return '<button class="ws-btn small" type="button" data-action="download-file" data-path="'+esc(file.storage_object_path||file.path)+'">'+svg('download',14)+esc((file.file_format||file.format||'file').toUpperCase())+' · '+esc(formatBytes(file.byte_size||file.byteSize))+'</button>';}).join('')+'</div></article>';}).join(''):'<p class="ws-help">'+esc(t('noDocuments'))+'</p>';
        return modalFrame(t('versions'),body,'<button class="ws-btn" type="button" data-action="close-modal">'+esc(t('close'))+'</button>');
    }

    function renderNotificationsModal() {
        var items=state.notifications||[];
        var body=items.length?'<div class="ws-notification-list">'+items.map(function(item){
            var payload=item.payload||{};
            if(typeof payload==='string'){try{payload=JSON.parse(payload);}catch(ignore){payload={};}}
            var title=item.title||t('notifications');
            var message=item.message||'';
            if(item.notification_type==='member_subscription_expired'){
                var memberName=payload.fullName||payload.full_name||payload.username||'';
                title=(memberName?memberName+' — ':'')+t('memberSubscriptionExpiredNotice');
                message=t('memberSubscriptionExpiredMessage');
            }
            return '<article class="ws-notification '+(item.read_at?'':'unread')+'"><span class="ws-notification-mark">'+svg('history',15)+'</span><div><strong>'+esc(title)+'</strong><p>'+esc(message)+'</p><time>'+esc(relativeTime(item.created_at))+'</time></div></article>';
        }).join('')+'</div>':'<div class="ws-empty compact"><p>'+esc(t('noNotifications'))+'</p></div>';
        return modalFrame(t('notifications'),body,'');
    }

    function renderShortcutsModal() {
        var body='<div class="ws-shortcut-grid"><span class="ws-key">N</span><span>'+esc(t('shortcutNew'))+'</span><span class="ws-key">/</span><span>'+esc(t('shortcutSearch'))+'</span><span class="ws-key">?</span><span>'+esc(t('shortcutHelp'))+'</span><span class="ws-key">Esc</span><span>'+esc(t('close'))+'</span></div>';
        return modalFrame(t('shortcuts'),body,'<button class="ws-btn" type="button" data-action="close-modal">'+esc(t('close'))+'</button>');
    }

    function setCurrentUser(user) {
        currentUser=user||null;
    }

    async function activate() {
        if (activationPromise) return activationPromise;
        root=document.getElementById('workspaceApp');
        if (!root) return Promise.resolve();
        bindEvents();
        state.loading=true;
        render();
        activationPromise=loadWorkspaces().catch(function(error){
            state.loading=false;
            state.workspace=null;
            render();
            toast(apiErrorMessage(error),'error');
        }).finally(function(){activationPromise=null;});
        scheduleEntitlementRefresh();
        return activationPromise;
    }

    function entitlementExpiryTimes() {
        var values=[];
        (state.workspaces||[]).forEach(function(workspace){
            [workspace.tariff_expires_at,workspace.member_tariff_expires_at].forEach(function(value){
                var time=value?new Date(value).getTime():NaN;
                if(Number.isFinite(time)&&time>Date.now())values.push(time);
            });
        });
        (state.members||[]).forEach(function(member){
            var time=member.tariff_expires_at?new Date(member.tariff_expires_at).getTime():NaN;
            if(Number.isFinite(time)&&time>Date.now())values.push(time);
        });
        return values;
    }

    function scheduleEntitlementRefresh() {
        if(entitlementTimer){clearTimeout(entitlementTimer);entitlementTimer=null;}
        if(previewMode||!state.activated)return;
        var expiries=entitlementExpiryTimes();
        if(!expiries.length)return;
        var delay=Math.max(1000,Math.min(2147483000,Math.min.apply(Math,expiries)-Date.now()+1000));
        entitlementTimer=setTimeout(function(){
            entitlementTimer=null;
            refreshWorkspaceEntitlements();
        },delay);
    }

    async function refreshWorkspaceEntitlements() {
        if(previewMode||!state.activated)return;
        try {
            var data=await api('GET','/workspaces');
            var latest=data.workspaces||[];
            state.workspaces=latest;
            if(!state.workspace)return;
            var current=latest.find(function(item){return item.id===state.workspace.id;});
            if(!current){await loadWorkspaces();return;}
            var wasActive=state.isActive;
            state.workspace=Object.assign({},state.workspace,current);
            state.isActive=current.is_active!==false;
            if(wasActive&&!state.isActive){await selectWorkspace(current.id);return;}
            if(!wasActive&&state.isActive){await selectWorkspace(current.id);return;}
            if(state.isActive&&state.role==='owner') {
                var members=await api('GET','/workspaces/'+current.id+'/members');
                var previous=JSON.stringify((state.members||[]).map(function(item){return [item.id,item.subscription_active];}));
                var previousNotifications=JSON.stringify((state.notifications||[]).map(function(item){return [item.id,item.read_at];}));
                state.members=members.members||[];
                var notifications=await api('GET','/workspaces/'+current.id+'/notifications').catch(function(){return{notifications:state.notifications||[]};});
                state.notifications=notifications.notifications||[];
                if(previous!==JSON.stringify(state.members.map(function(item){return [item.id,item.subscription_active];}))||previousNotifications!==JSON.stringify(state.notifications.map(function(item){return [item.id,item.read_at];})))render();
            }
        } catch(error) {
            if(error&&[401,402,403].includes(error.status)&&state.workspace) await selectWorkspace(state.workspace.id).catch(function(){});
        } finally {
            scheduleEntitlementRefresh();
        }
    }

    async function loadWorkspaces(preferredId) {
        var data=await api('GET','/workspaces');
        state.workspaces=data.workspaces||[];
        state.loading=false;
        state.activated=true;
        if (!state.workspaces.length) {
            state.workspace=null;
            state.workspaceGate=hasPlatinum()?'empty':'locked';
            render();
            return;
        }
        var saved=preferredId||localStorage.getItem('juristai-workspace-id');
        var workspace=state.workspaces.find(function(item){return item.id===saved;})||state.workspaces[0];
        await selectWorkspace(workspace.id);
    }

    async function selectWorkspace(workspaceId) {
        await disconnectRealtime();
        state.workspace=state.workspaces.find(function(item){return item.id===workspaceId;})||null;
        if (!state.workspace) return;
        state.role=state.workspace.role||'viewer';
        state.isActive=state.workspace.is_active!==undefined?!!state.workspace.is_active:state.workspace.isActive!==undefined?!!state.workspace.isActive:true;
        state.currentTask=null; state.detail=null; state.conflict=null; state.ai={open:false,taskId:null,threadId:null,messages:[],loading:false,lastResult:null};
        localStorage.setItem('juristai-workspace-id',workspaceId);
        if (!state.isActive) {
            var reason=String(state.workspace.unavailable_reason||state.workspace.unavailableReason||'');
            state.workspaceGate=reason==='owner_subscription_expired'?'owner-expired':reason==='member_subscription_expired'?'member-expired':'locked';
            state.loading=false;
            state.tasks=[];state.members=[];state.documents=[];state.messages=[];state.notifications=[];
            render();
            return;
        }
        state.workspaceGate=null;
        state.loading=true; render();
        var base='/workspaces/'+workspaceId;
        var responses=await Promise.all([
            api('GET',base), api('GET',base+'/members'), loadTasks(false),
            api('GET',base+'/documents'), api('GET',base+'/activity?limit=100'),
            api('GET',base+'/memory'), api('GET',base+'/assistant/threads').catch(function(){return{threads:[]};}),
            api('GET',base+'/messages').catch(function(){return{messages:[]};}),
            api('GET',base+'/notifications').catch(function(){return{notifications:[]};})
        ]);
        var metadata=responses[0], memberData=responses[1];
        state.workspace=Object.assign({},state.workspace,metadata.workspace||{});
        state.counts=metadata.counts||{};
        state.role=memberData.currentRole||state.role;
        state.isActive=metadata.workspace&&metadata.workspace.isActive!==undefined?!!metadata.workspace.isActive:state.isActive;
        state.members=memberData.members||[];
        state.documents=responses[3].documents||[];
        state.activity=responses[4].activity||[];
        state.memory=responses[5].memory||[];
        state.threads=responses[6].threads||[];
        state.messages=responses[7].messages||[];
        state.notifications=responses[8].notifications||[];
        state.loading=false;
        scheduleEntitlementRefresh();
        render();
        connectRealtime().catch(function(error){
            state.realtimeStatus='offline'; render();
            if (!previewMode) console.warn('[Workspace Realtime]',error);
        });
    }

    async function loadTasks(shouldRender) {
        if (!state.workspace) return {items:[]};
        var params=new URLSearchParams({limit:'200',offset:'0'});
        Object.keys(state.filters).forEach(function(key){if(state.filters[key])params.set(key,state.filters[key]);});
        var endpoint='/workspaces/'+state.workspace.id+'/'+(state.view==='timeline'?'timeline':'tasks')+'?'+params.toString();
        var data=await api('GET',endpoint);
        state.tasks=data.items||[];
        if (shouldRender!==false) render();
        return data;
    }

    async function openTask(taskId) {
        if (!state.workspace) return;
        state.currentTask=taskId;
        state.detail=null;
        state.conflict=null;
        render();
        try {
            state.detail=await api('GET','/workspaces/'+state.workspace.id+'/tasks/'+taskId);
            render();
            connectTaskPresence(taskId).catch(function(error){if(!previewMode)console.warn('[Workspace Presence]',error);});
            setTimeout(function(){var input=document.getElementById('wsDetailTitleInput');if(input)input.focus();},80);
        } catch(error) {
            state.currentTask=null; state.detail=null; render(); toast(apiErrorMessage(error),'error');
        }
    }

    async function refreshCurrentTask(showBanner) {
        if (!state.workspace||!state.currentTask) return;
        var taskId=state.currentTask;
        var detail=await api('GET','/workspaces/'+state.workspace.id+'/tasks/'+taskId);
        if (state.currentTask!==taskId) return;
        state.detail=detail;
        if (showBanner) state.conflict={live:true};
        render();
    }

    async function closeTaskDetail() {
        if (taskPresenceChannel&&state.supabase) {
            try{await state.supabase.removeChannel(taskPresenceChannel);}catch(_error){}
        }
        taskPresenceChannel=null;
        state.currentTask=null;state.detail=null;state.presence=[];state.conflict=null;render();
    }

    function currentUserId() {
        return Number((currentUser&&(currentUser.adminId||currentUser.id))||(previewMode?9001:0));
    }

    function bindEvents() {
        if (!root||root.dataset.workspaceBound==='1') return;
        root.dataset.workspaceBound='1';
        root.addEventListener('click',handleClick);
        root.addEventListener('change',handleChange);
        root.addEventListener('input',handleInput);
        root.addEventListener('submit',handleSubmit);
        root.addEventListener('pointerdown',handleTimelineDrag);
        document.addEventListener('keydown',handleKeyboard);
        document.addEventListener('click',handleDocumentClick);
        global.addEventListener('focus',refreshWorkspaceEntitlements);
        document.addEventListener('visibilitychange',function(){
            if(document.visibilityState==='visible')refreshWorkspaceEntitlements();
        });
    }

    function handleDocumentClick(event) {
        if (!root || !root.contains(event.target) || !event.target.closest('.ws-dropdown')) closeDropdowns();
        if (!root || !root.contains(event.target) || !event.target.closest('.ws-date-picker')) closeDatePickers();
    }

    function handleClick(event) {
        var target=event.target.closest('[data-action]');
        if (!target||!root.contains(target)) return;
        var action=target.dataset.action;
        if (action==='date-input') {
            toggleDatePicker(target.closest('.ws-date-picker'), true);
            return;
        }
        if (action==='date-toggle') {
            event.preventDefault();
            toggleDatePicker(target.closest('.ws-date-picker'));
            return;
        }
        if (action==='date-previous'||action==='date-next') {
            event.preventDefault();
            changeDatePickerMonth(target.closest('.ws-date-picker'), action==='date-previous' ? -1 : 1);
            return;
        }
        if (action==='date-day') {
            event.preventDefault();
            var dayPicker=target.closest('.ws-date-picker');
            setDatePickerValue(dayPicker, target.dataset.date);
            toggleDatePicker(dayPicker, false);
            return;
        }
        if (action==='date-today'||action==='date-clear') {
            event.preventDefault();
            var quickPicker=target.closest('.ws-date-picker');
            setDatePickerValue(quickPicker, action==='date-today' ? normalizeDateValue(new Date().toISOString()) : '');
            toggleDatePicker(quickPicker, false);
            return;
        }
        if (action==='dropdown-toggle') {
            event.preventDefault();
            toggleDropdown(target.closest('.ws-dropdown'));
            return;
        }
        if (action==='dropdown-option') {
            event.preventDefault();
            var dropdown=target.closest('.ws-dropdown');
            var nativeSelect=dropdown&&dropdown.querySelector('select.ws-native-select');
            if (!nativeSelect || target.disabled) return;
            nativeSelect.value=target.dataset.value;
            syncDropdown(dropdown);
            toggleDropdown(dropdown,false);
            nativeSelect.dispatchEvent(new Event('change',{bubbles:true}));
            return;
        }
        if (action==='close-detail') { if(target===event.currentTarget||target.closest('.ws-detail-panel')||target.classList.contains('ws-detail-backdrop')) closeTaskDetail(); return; }
        if (action==='open-task') {openTask(target.dataset.taskId);return;}
        if (action==='new-task') {state.modal='task';state.modalData={};render();return;}
        if (action==='view-list'||action==='view-timeline'||action==='view-graph') {state.view=action==='view-list'?'list':action==='view-timeline'?'timeline':'graph';loadTasks();return;}
        if (action==='timeline-zoom') {state.timelineZoom=target.dataset.zoom;render();return;}
        if (action==='close-modal') {
            if (target.classList.contains('ws-modal-backdrop') && event.target !== target) return;
            state.modal=null;state.modalData=null;state.inviteUrl=null;render();return;
        }
        if (action==='open-members') {openMembers();return;}
        if (action==='open-notifications') {openNotifications();return;}
        if (action==='open-chat') {state.modal='chat';render();return;}
        if (action==='open-shared-documents') {state.modal='shared-documents';render();return;}
        if (action==='open-member-profile') {var member=state.members.find(function(item){return String(item.id)===String(target.dataset.memberId);});if(member){state.modal='member-profile';state.modalData={member:member};render();}return;}
        if (action==='open-task-from-modal') {state.modal=null;state.modalData=null;openTask(target.dataset.taskId);return;}
        if (action==='open-ai') {openAi(target.dataset.taskId||null);return;}
        if (action==='new-ai-conversation') {newAiConversation();return;}
        if (action==='close-ai') {state.ai.open=false;render();return;}
        if (action==='shortcuts') {state.modal='shortcuts';render();return;}
        if (action==='delete-task') {deleteCurrentTask();return;}
        if (action==='versions') {openVersions(target.dataset.documentId);return;}
        if (action==='download-file') {downloadFile(target.dataset.path);return;}
        if (action==='copy-invite') {copyInvite();return;}
        if (action==='save-ai-document') {saveAiAsDocument(target.dataset.runId);return;}
        if (action==='copy-ai-answer') {copyAiAnswer(Number(target.dataset.messageIndex));return;}
        if (action==='download-ai-answer') {downloadAiAnswer(Number(target.dataset.messageIndex));return;}
        if (action==='rate-ai-answer') {rateAiAnswer(Number(target.dataset.messageIndex),target.dataset.rating);return;}
        if (action==='workspace-ai-next-action') {runWorkspaceAiNextAction(Number(target.dataset.messageIndex),Number(target.dataset.nextIndex));return;}
    }

    function handleChange(event) {
        var target=event.target;
        if (target.dataset.action==='date-input') {syncTypedDate(target,true);return;}
        if (target.dataset.action==='switch-workspace') {selectWorkspace(target.value).catch(function(error){toast(apiErrorMessage(error),'error');});return;}
        if (target.dataset.action==='language') {state.language=target.value;localStorage.setItem('juristai-workspace-language',state.language);render();return;}
        if (target.dataset.action==='ai-thread') {if(target.value)loadAiThread(target.value);return;}
        if (target.dataset.action==='change-member-role') {changeMemberRole(target.dataset.memberId,target.value);return;}
        if (target.dataset.action==='upload-document'&&target.files&&target.files[0]) {uploadDocument(target.files[0]);return;}
        if (target.dataset.action==='upload-shared-document'&&target.files&&target.files[0]) {uploadSharedDocument(target.files[0]);return;}
        if (target.dataset.filter&&target.dataset.filter!=='search') {state.filters[target.dataset.filter]=target.value;loadTasks().catch(function(error){toast(apiErrorMessage(error),'error');});return;}
        if (target.type==='checkbox'&&target.closest('.ws-person-chip')) target.closest('.ws-person-chip').classList.toggle('selected',target.checked);
    }

    function handleInput(event) {
        var target=event.target;
        if (target.dataset.action==='date-input') {syncTypedDate(target,false);return;}
        if (target.dataset.filter==='search') {
            state.filters.search=target.value;
            clearTimeout(searchTimer);
            searchTimer=setTimeout(function(){loadTasks().catch(function(error){toast(apiErrorMessage(error),'error');});},280);
        }
    }

    function handleSubmit(event) {
        var form=event.target.closest('[data-form]');
        if (!form) return;
        event.preventDefault();
        var type=form.dataset.form;
        if (type==='create-workspace') createWorkspace(form);
        else if (type==='create-task') createTask(form);
        else if (type==='update-task') updateTask(form);
        else if (type==='comment') createComment(form);
        else if (type==='invite') createInvitation(form);
        else if (type==='workspace-message') createWorkspaceMessage(form);
        else if (type==='ai') askAssistant(form);
    }

    function handleKeyboard(event) {
        var tag=(event.target&&event.target.tagName||'').toLowerCase();
        var typing=['input','textarea','select'].includes(tag)||event.target&&event.target.isContentEditable;
        var dropdown=event.target&&event.target.closest&&event.target.closest('.ws-dropdown');
        if (dropdown && ['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
            event.preventDefault();
            toggleDropdown(dropdown,true);
            var options=Array.from(dropdown.querySelectorAll('.ws-dropdown-option:not(:disabled)'));
            if (!options.length) return;
            var current=options.indexOf(document.activeElement);
            var next=event.key==='Home'?0:event.key==='End'?options.length-1:event.key==='ArrowUp'?Math.max(0,current<0?options.length-1:current-1):Math.min(options.length-1,current+1);
            options[next].focus();
            return;
        }
        if (event.key==='Escape') {
            if(root&&root.querySelector('.ws-dropdown.open')){closeDropdowns();return;}
            if(root&&root.querySelector('.ws-date-picker.open')){closeDatePickers();return;}
            if(state.modal){state.modal=null;state.modalData=null;render();}
            else if(state.ai.open){state.ai.open=false;render();}
            else if(state.currentTask)closeTaskDetail();
            return;
        }
        if (typing) return;
        if (event.key==='?' ) {event.preventDefault();state.modal='shortcuts';render();}
        if ((event.key==='n'||event.key==='N')&&canWrite()) {event.preventDefault();state.modal='task';state.modalData={};render();}
        if (event.key==='/') {event.preventDefault();var input=root&&root.querySelector('[data-filter="search"]');if(input)input.focus();}
    }

    function formValues(form) {
        var data=new FormData(form), values={};
        data.forEach(function(value,key){
            if (Object.prototype.hasOwnProperty.call(values,key)) values[key]=[].concat(values[key],value);
            else values[key]=value;
        });
        return values;
    }

    function checkedIds(form,name) {
        return Array.from(form.querySelectorAll('input[name="'+name+'"]:checked')).map(function(input){return Number(input.value);}).filter(Number.isFinite);
    }

    async function createWorkspace(form) {
        var button=form.querySelector('button[type="submit"]');
        try {
            if(button)button.disabled=true;
            var values=formValues(form);
            var result=await api('POST','/workspaces',{name:values.name,defaultLanguage:state.language});
            state.workspaceGate=null;
            await loadWorkspaces(result.workspace.id);
        } catch(error) {
            if(error.status===402||error.code==='workspace_platinum_required') state.workspaceGate='platinum';
            render();toast(apiErrorMessage(error),'error');
        } finally {if(button)button.disabled=false;}
    }

    async function createTask(form) {
        var values=formValues(form), submit=form.querySelector('button[type="submit"]');
        try {
            if(submit)submit.disabled=true;
            var payload={title:String(values.title||'').trim(),description:String(values.description||'').trim(),status:values.status||'todo',priority:values.priority||'normal',startDate:values.startDate||null,dueDate:values.dueDate||null,isMilestone:!!values.isMilestone,assigneeIds:checkedIds(form,'assigneeIds'),watcherIds:[]};
            var result=await api('POST','/workspaces/'+state.workspace.id+'/tasks',payload);
            state.modal=null;state.modalData=null;
            await loadTasks(false);render();toast(t('taskCreated'),'success');
            openTask(result.task.id);
        } catch(error) {toast(apiErrorMessage(error),'error');if(submit)submit.disabled=false;}
    }

    async function updateTask(form) {
        if(!state.detail||!canWrite())return;
        var values=formValues(form),task=state.detail.task,submit=form.querySelector('button[type="submit"]');
        try {
            if(submit)submit.disabled=true;
            var payload={title:String(values.title||'').trim(),description:String(values.description||'').trim(),status:values.status,priority:values.priority,startDate:values.startDate||null,dueDate:values.dueDate||null,isMilestone:!!values.isMilestone,clientRevision:Number(task.revision)};
            var result=await api('PATCH','/workspaces/'+state.workspace.id+'/tasks/'+task.id,payload);
            await Promise.all([
                api('PUT','/workspaces/'+state.workspace.id+'/tasks/'+task.id+'/assignees',{userIds:checkedIds(form,'assigneeIds')}),
                api('PUT','/workspaces/'+state.workspace.id+'/tasks/'+task.id+'/watchers',{userIds:checkedIds(form,'watcherIds')})
            ]);
            state.conflict=result.task&&result.task.conflict||null;
            await Promise.all([loadTasks(false),refreshCurrentTask(false)]);
            render();toast(t('taskUpdated'),'success');
        } catch(error) {toast(apiErrorMessage(error),'error');if(submit)submit.disabled=false;}
    }

    async function deleteCurrentTask() {
        if(!state.detail||!canWrite()||!global.confirm(t('confirmDeleteTask')))return;
        try {
            await api('DELETE','/workspaces/'+state.workspace.id+'/tasks/'+state.detail.task.id);
            await closeTaskDetail();
            await loadTasks();
            toast(t('taskDeleted'),'success');
        } catch(error){toast(apiErrorMessage(error),'error');}
    }

    async function createComment(form) {
        if(!state.detail||!canWrite())return;
        var input=form.elements.body,body=String(input.value||'').trim(),button=form.querySelector('button[type="submit"]');
        if(!body)return;
        try {
            if(button)button.disabled=true;
            await api('POST','/workspaces/'+state.workspace.id+'/tasks/'+state.detail.task.id+'/comments',{body:body});
            await refreshCurrentTask(false);
        } catch(error){toast(apiErrorMessage(error),'error');if(button)button.disabled=false;}
    }

    async function openMembers() {
        try {
            if(isOwner()) {
                var data=await api('GET','/workspaces/'+state.workspace.id+'/invitations');
                state.invitations=data.invitations||[];
            }
            state.modal='members';state.inviteUrl=null;render();
        } catch(error){toast(apiErrorMessage(error),'error');}
    }

    async function openNotifications() {
        state.modal='notifications';
        render();
        var unread=(state.notifications||[]).filter(function(item){return !item.read_at;});
        if(!unread.length)return;
        try {
            await Promise.all(unread.map(function(item){
                return api('PATCH','/workspaces/'+state.workspace.id+'/notifications/'+item.id+'/read',{});
            }));
            var readAt=new Date().toISOString();
            state.notifications=(state.notifications||[]).map(function(item){
                return item.read_at||!unread.some(function(unreadItem){return unreadItem.id===item.id;})?item:Object.assign({},item,{read_at:readAt});
            });
            render();
        } catch(error){toast(apiErrorMessage(error),'error');}
    }

    async function createInvitation(form) {
        if(!isOwner())return;
        var values=formValues(form),target=String(values.target||'').trim(),button=form.querySelector('button[type="submit"]');
        try {
            if(button)button.disabled=true;
            var payload={role:values.role,expiresInHours:Number(values.expiresInHours||72)};
            if(target.includes('@'))payload.email=target;else payload.username=target.replace(/^@/,'');
            var result=await api('POST','/workspaces/'+state.workspace.id+'/invitations',payload);
            state.inviteUrl=result.inviteUrl;
            state.telegramShareUrl=result.telegramShareUrl||('https://t.me/share/url?url='+encodeURIComponent(result.inviteUrl));
            var data=await api('GET','/workspaces/'+state.workspace.id+'/invitations');
            state.invitations=data.invitations||[];
            render();
        } catch(error){toast(apiErrorMessage(error),'error');if(button)button.disabled=false;}
    }

    async function copyInvite() {
        if(!state.inviteUrl)return;
        try {await navigator.clipboard.writeText(state.inviteUrl);toast(t('copied'),'success');}
        catch(_error){var input=root.querySelector('.ws-invite-link input');if(input){input.select();document.execCommand('copy');toast(t('copied'),'success');}}
    }

    async function changeMemberRole(memberId,role) {
        if(!isOwner())return;
        try {
            await api('PATCH','/workspaces/'+state.workspace.id+'/members/'+memberId,{role:role});
            var data=await api('GET','/workspaces/'+state.workspace.id+'/members');state.members=data.members||[];render();
        } catch(error){toast(apiErrorMessage(error),'error');}
    }

    async function openVersions(documentId) {
        try {
            var data=await api('GET','/workspaces/'+state.workspace.id+'/documents/'+documentId+'/versions');
            state.modal='versions';state.modalData={documentId:documentId,versions:data.versions||[]};render();
        } catch(error){toast(apiErrorMessage(error),'error');}
    }

    var FILE_TYPES={
        'application/pdf':'pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document':'docx','application/rtf':'rtf','text/rtf':'rtf','text/plain':'txt','image/jpeg':'jpg','image/png':'png'
    };

    async function fileSha256(file) {
        var digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
        return Array.from(new Uint8Array(digest)).map(function(value){return value.toString(16).padStart(2,'0');}).join('');
    }

    function safeFileName(name) {
        return String(name||'file').normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(-180)||'file';
    }

    async function uploadWorkspaceFile(file,taskId) {
        if(!canWrite())return;
        if(file.size>52428800){toast(t('fileTooLarge'),'error');return;}
        var format=FILE_TYPES[file.type];
        if(!format){toast(t('unsupportedFile'),'error');return;}
        try {
            toast(t('loading'));
            var created=await api('POST','/workspaces/'+state.workspace.id+'/documents',{taskId:taskId||null,title:file.name,kind:'upload'});
            var objectPath=created.storagePathPrefix+Date.now()+'-'+safeFileName(file.name);
            if(!previewMode) {
                var client=await ensureSupabase();
                var upload=await client.storage.from('workspace-documents').upload(objectPath,file,{contentType:file.type,upsert:false,cacheControl:'3600'});
                if(upload.error)throw upload.error;
            }
            await api('POST','/workspaces/'+state.workspace.id+'/documents/'+created.document.id+'/versions/'+created.version.id+'/files',{fileFormat:'original',objectPath:objectPath,mimeType:file.type,byteSize:file.size,sha256:await fileSha256(file)});
            var docs=await api('GET','/workspaces/'+state.workspace.id+'/documents');state.documents=docs.documents||[];
            await Promise.all([taskId&&state.currentTask===taskId?refreshCurrentTask(false):Promise.resolve(),loadTasks(false)]);
            render();toast(t('uploadComplete'),'success');
        } catch(error){toast(t('uploadFailed')+': '+apiErrorMessage(error),'error');}
    }

    function uploadDocument(file) { return uploadWorkspaceFile(file,state.detail&&state.detail.task&&state.detail.task.id); }
    function uploadSharedDocument(file) { return uploadWorkspaceFile(file,null); }

    async function createWorkspaceMessage(form) {
        if(!canWrite())return;
        var values=formValues(form),body=String(values.body||'').trim(),button=form.querySelector('button[type="submit"]');
        if(!body)return;
        try{
            if(button)button.disabled=true;
            await api('POST','/workspaces/'+state.workspace.id+'/messages',{body:body,pinnedTaskId:values.pinnedTaskId||null});
            var data=await api('GET','/workspaces/'+state.workspace.id+'/messages');state.messages=data.messages||[];render();
        }catch(error){toast(apiErrorMessage(error),'error');if(button)button.disabled=false;}
    }

    async function downloadFile(path) {
        if(!path)return;
        try {
            if(previewMode){toast(t('previewNotice'),'success');return;}
            var client=await ensureSupabase();
            var result=await client.storage.from('workspace-documents').createSignedUrl(path,120);
            if(result.error)throw result.error;
            global.open(result.data.signedUrl,'_blank','noopener');
        } catch(error){toast(apiErrorMessage(error),'error');}
    }

    function openAi(taskId) {
        state.ai.open=true;state.ai.taskId=taskId||null;state.ai.threadId=null;state.ai.messages=[];state.ai.loading=false;state.ai.lastResult=null;render();
        setTimeout(function(){var input=document.getElementById('wsAiInput');if(input)input.focus();},80);
    }

    function newAiConversation() {
        state.ai.threadId=null;
        state.ai.messages=[];
        state.ai.lastResult=null;
        state.ai.loading=false;
        render();
        setTimeout(function(){var input=document.getElementById('wsAiInput');if(input)input.focus();},80);
    }

    async function loadAiThread(threadId) {
        if(!state.workspace||!threadId)return;
        state.ai.loading=true;render();
        try {
            var data=await api('GET','/workspaces/'+state.workspace.id+'/assistant/threads/'+threadId);
            state.ai.threadId=data.thread.id;
            state.ai.taskId=data.thread.task_id||null;
            state.ai.messages=(data.messages||[]).map(function(message){return{role:message.role,content:message.content,result:message.result||{}};});
            state.ai.lastResult=[].concat(state.ai.messages).reverse().find(function(message){return message.role==='assistant';})?.result||null;
        } catch(error){toast(apiErrorMessage(error),'error');}
        state.ai.loading=false;render();
        setTimeout(function(){var box=document.getElementById('wsAiMessages');if(box)box.scrollTop=box.scrollHeight;},30);
    }

    function precedingAiQuestion(messageIndex) {
        for(var index=messageIndex-1;index>=0;index-=1){
            if(state.ai.messages[index]&&state.ai.messages[index].role==='user')return state.ai.messages[index].content||'';
        }
        return '';
    }

    async function copyAiAnswer(messageIndex) {
        var message=state.ai.messages[messageIndex];
        if(!message||message.role!=='assistant')return;
        try {
            await navigator.clipboard.writeText(String(message.content||''));
            toast(t('answerCopied'),'success');
        } catch(error){toast(apiErrorMessage(error),'error');}
    }

    function downloadAiAnswer(messageIndex) {
        var message=state.ai.messages[messageIndex];
        if(!message||message.role!=='assistant')return;
        var html='<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><style>body,p,li,td,th,span,div,a,h1,h2,h3,h4,strong,em{font-family:Calibri,sans-serif!important}body{font-size:12pt;line-height:1.55}a{color:#17456a}</style></head><body>'+safeMarkdown(message.content)+'</body></html>';
        var blob=new Blob(['\ufeff'+html],{type:'application/msword'});
        var url=URL.createObjectURL(blob),link=document.createElement('a');
        link.href=url;link.download='JuristAI_Workspace_javob_'+new Date().toISOString().slice(0,10)+'.doc';
        document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
    }

    async function rateAiAnswer(messageIndex,rating) {
        var message=state.ai.messages[messageIndex];
        if(!message||message.role!=='assistant'||!['good','bad'].includes(rating)||message.result&&message.result.userRating)return;
        var result=message.result||{},question=precedingAiQuestion(messageIndex);
        result.userRating=rating;message.result=result;render();
        if(previewMode){toast(t('feedbackSaved'),'success');return;}
        try {
            await api('POST','/jurist-feedback',{rating:rating,userQuestion:question,aiResponse:String(message.content||'').slice(0,2000),topic:result.topic||null});
            if(result.qaBank&&result.qaBank.source==='verified_qa'&&Number.isInteger(Number(result.qaBank.id)))api('POST','/legal-chat/feedback',{qaChunkId:Number(result.qaBank.id),helpful:rating==='good'}).catch(function(){});
            toast(t('feedbackSaved'),'success');
        } catch(error){result.userRating=null;render();toast(apiErrorMessage(error),'error');}
    }

    function runWorkspaceAiNextAction(messageIndex,actionIndex) {
        var message=state.ai.messages[messageIndex];
        var result=message&&message.result||{};
        var action=Array.isArray(result.nextActions)&&result.nextActions[actionIndex];
        if(!action)return;
        if(action.kind==='attorney') {
            global.location.assign('/attorneys.html?source=workspace-ai');
            return;
        }
        if(action.kind!=='document')return;
        if(previewMode||typeof global.docFlowPickType!=='function'||typeof global.switchTab!=='function') {
            toast(t('previewNotice'),'success');
            return;
        }
        var continuation={
            question:precedingAiQuestion(messageIndex),
            answer:String(message.content||''),
            selectedAction:action.label||action.documentType||'Yuridik hujjat',
            inputFields:Array.isArray(action.inputFields)?action.inputFields:[],
            workspaceId:state.workspace&&state.workspace.id||null,
            taskId:state.ai.taskId||null,
            sourceAiRunId:result.runId||null
        };
        state.ai.open=false;
        render();
        global.switchTab('ai');
        setTimeout(function(){
            global.docFlowPickType(action.documentType||'Yuridik hujjat',continuation);
            toast(t('openMainAi'),'success');
        },60);
    }

    async function askAssistant(form) {
        if(!canWrite()||state.ai.loading)return;
        var input=form.elements.question,question=String(input.value||'').trim();
        if(question.length<3)return;
        state.ai.messages.push({role:'user',content:question});state.ai.loading=true;render();
        try {
            var payload={question:question,taskId:state.ai.taskId||null,threadId:state.ai.threadId||null};
            var result=await api('POST','/workspaces/'+state.workspace.id+'/assistant/ask',payload);
            state.ai.threadId=result.threadId||state.ai.threadId;
            if(result.status==='in_progress') result=await waitForAiResult(result);
            state.ai.lastResult=result;
            state.ai.messages.push({role:'assistant',content:result.reply||t('generated'),result:result});
            if(result.memoryItemId&&!state.memory.some(function(item){return item.id===result.memoryItemId;}))state.memory.unshift({id:result.memoryItemId,kind:'answer'});
            state.counts.memory_items=Math.max(Number(state.counts.memory_items||0),state.memory.length);
            if(previewMode) {
                if(!state.threads.some(function(thread){return thread.id===result.threadId;}))state.threads.unshift({id:result.threadId,task_id:state.ai.taskId||null,title:question,message_count:2,updated_at:new Date().toISOString()});
            } else {
                var threadData=await api('GET','/workspaces/'+state.workspace.id+'/assistant/threads').catch(function(){return{threads:state.threads||[]};});
                state.threads=threadData.threads||state.threads||[];
            }
        } catch(error){state.ai.messages.push({role:'assistant',content:t('aiFailed')+': '+apiErrorMessage(error),result:{}});}
        state.ai.loading=false;render();
        setTimeout(function(){var box=document.getElementById('wsAiMessages');if(box)box.scrollTop=box.scrollHeight;},30);
    }

    async function waitForAiResult(initial) {
        var attempts=0;
        while(attempts<30) {
            await new Promise(function(resolve){setTimeout(resolve,2000);});
            var runData=await api('GET','/workspaces/'+state.workspace.id+'/assistant/runs/'+initial.runId);
            if(['succeeded','reused'].includes(runData.run.status)) {
                if(runData.result)return runData.result;
                var threadData=await api('GET','/workspaces/'+state.workspace.id+'/assistant/threads/'+initial.threadId);
                var last=(threadData.messages||[]).filter(function(message){return message.role==='assistant';}).pop();
                return Object.assign({},initial,{status:'succeeded',reused:runData.run.status==='reused',reply:last&&last.content||'',usage:{inTokens:runData.run.input_tokens,outTokens:runData.run.output_tokens,costUsd:runData.run.estimated_cost_usd}});
            }
            if(runData.run.status==='failed')throw new Error(runData.run.error_message||t('aiFailed'));
            attempts+=1;
        }
        throw new Error(t('aiFailed'));
    }

    async function saveAiAsDocument(runId) {
        if(!state.ai.taskId||!state.ai.lastResult)return;
        try {
            var sourceTask=state.tasks.find(function(task){return task.id===state.ai.taskId;});
            await api('POST','/workspaces/'+state.workspace.id+'/documents',{taskId:state.ai.taskId,title:(sourceTask?sourceTask.title:t('task'))+' — '+t('aiConclusion'),kind:'generated',contentText:state.ai.lastResult.reply,sourceAiRunId:runId});
            if(state.currentTask===state.ai.taskId)await refreshCurrentTask(false);
            await loadTasks(false);render();toast(t('aiSaved'),'success');
        } catch(error){toast(apiErrorMessage(error),'error');}
    }

    function loadSupabaseLibrary() {
        if(global.supabase&&global.supabase.createClient)return Promise.resolve(global.supabase);
        if(supabaseLoader)return supabaseLoader;
        supabaseLoader=new Promise(function(resolve,reject){
            var script=document.createElement('script');
            script.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
            script.async=true;
            script.onload=function(){global.supabase&&global.supabase.createClient?resolve(global.supabase):reject(new Error('Supabase client unavailable'));};
            script.onerror=function(){reject(new Error('Supabase client could not load'));};
            document.head.appendChild(script);
        });
        return supabaseLoader;
    }

    async function issueBridgeToken() {
        var bridge=await api('POST','/workspace-realtime/token',{workspaceId:state.workspace.id});
        state.bridge=bridge;
        clearTimeout(tokenTimer);
        var expiresAt=new Date(bridge.expiresAt||Date.now()+300000).getTime();
        tokenTimer=setTimeout(refreshRealtimeToken,Math.max(30000,expiresAt-Date.now()-45000));
        return bridge;
    }

    async function ensureSupabase() {
        if(previewMode)return null;
        if(state.supabase)return state.supabase;
        var bridge=await issueBridgeToken();
        var library=await loadSupabaseLibrary();
        state.supabase=library.createClient(bridge.supabaseUrl,bridge.supabaseKey,{
            auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
            global:{headers:{Authorization:'Bearer '+bridge.token}}
        });
        state.supabase.realtime.setAuth(bridge.token);
        return state.supabase;
    }

    async function refreshRealtimeToken() {
        if(previewMode||!state.workspace)return;
        try {
            var bridge=await issueBridgeToken();
            if(state.supabase)state.supabase.realtime.setAuth(bridge.token);
        } catch(error){state.realtimeStatus='offline';render();console.warn('[Workspace Realtime token]',error);}
    }

    async function connectRealtime() {
        if(!state.workspace)return;
        if(previewMode){state.realtimeStatus='preview';render();return;}
        state.realtimeStatus='connecting';render();
        var client=await ensureSupabase();
        if(state.realtimeChannel)await client.removeChannel(state.realtimeChannel);
        var channel=client.channel('workspace:'+state.workspace.id+':changes');
        ['workspace_tasks','workspace_task_assignees','workspace_task_watchers','workspace_task_comments','workspace_task_links','workspace_task_documents','workspace_documents','workspace_document_versions','workspace_document_files','workspace_memory_items','workspace_activity_log','workspace_messages','workspace_notifications'].forEach(function(table){
            channel.on('postgres_changes',{event:'*',schema:'public',table:table,filter:'workspace_id=eq.'+state.workspace.id},function(payload){handleRealtimeChange(table,payload);});
        });
        state.realtimeChannel=channel;
        channel.subscribe(function(status){
            if(status==='SUBSCRIBED')state.realtimeStatus='online';
            else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'||status==='CLOSED')state.realtimeStatus='offline';
            else state.realtimeStatus='connecting';
            render();
        });
    }

    async function disconnectRealtime() {
        clearTimeout(tokenTimer);
        if(state.supabase&&taskPresenceChannel){try{await state.supabase.removeChannel(taskPresenceChannel);}catch(_error){}}
        if(state.supabase&&state.realtimeChannel){try{await state.supabase.removeChannel(state.realtimeChannel);}catch(_error){}}
        taskPresenceChannel=null;state.realtimeChannel=null;state.presence=[];state.realtimeStatus=previewMode?'preview':'offline';
    }

    function handleRealtimeChange(table,payload) {
        var record=payload.new||payload.old||{};
        var fromOther=Number(record.updated_by||record.author_id||record.created_by||0)!==currentUserId();
        debounceRefresh(async function(){
            try {
                if(table==='workspace_messages'){var messages=await api('GET','/workspaces/'+state.workspace.id+'/messages');state.messages=messages.messages||[];render();return;}
                if(table==='workspace_notifications'){var notifications=await api('GET','/workspaces/'+state.workspace.id+'/notifications');state.notifications=notifications.notifications||[];render();return;}
                if(table.indexOf('workspace_document')===0){var docs=await api('GET','/workspaces/'+state.workspace.id+'/documents');state.documents=docs.documents||[];}
                await loadTasks(false);
                if(state.currentTask)await refreshCurrentTask(fromOther);
                else render();
            } catch(error){console.warn('[Workspace live refresh]',error);}
        },180);
    }

    async function connectTaskPresence(taskId) {
        if(previewMode){state.presence=DEMO.members.slice(0,2).map(function(member){return{fullName:member.full_name,username:member.username,id:member.id};});render();return;}
        var client=await ensureSupabase();
        if(taskPresenceChannel)await client.removeChannel(taskPresenceChannel);
        var uid=currentUserId();
        var payload={id:uid,fullName:currentUser&&(currentUser.fullName||currentUser.username)||'Workspace member',username:currentUser&&currentUser.username||'',onlineAt:new Date().toISOString()};
        var channel=client.channel('workspace:'+state.workspace.id+':task:'+taskId,{config:{private:true,presence:{key:String(uid)}}});
        channel.on('presence',{event:'sync'},function(){
            var presenceState=channel.presenceState(),people=[];
            Object.keys(presenceState).forEach(function(key){(presenceState[key]||[]).forEach(function(item){if(!people.some(function(p){return String(p.id)===String(item.id);}))people.push(item);});});
            state.presence=people;render();
        });
        channel.subscribe(function(status){if(status==='SUBSCRIBED')channel.track(payload);});
        taskPresenceChannel=channel;
    }

    function addDays(dateString,days) {
        var date=new Date(dateString+'T00:00:00Z');
        date.setUTCDate(date.getUTCDate()+days);
        return date.toISOString().slice(0,10);
    }

    function handleTimelineDrag(event) {
        var bar=event.target.closest('.ws-timeline-bar');
        if(!bar||!canWrite()||global.innerWidth<760)return;
        event.preventDefault();
        var track=bar.parentElement,taskId=bar.dataset.taskId,startX=event.clientX,startDate=bar.dataset.start,dueDate=bar.dataset.due;
        var range=timelineRange(),days=Math.max(1,(range.max-range.min)/86400000),trackWidth=track.getBoundingClientRect().width;
        bar.setPointerCapture&&bar.setPointerCapture(event.pointerId);
        function move(moveEvent){var delta=moveEvent.clientX-startX;bar.style.transform='translateX('+delta+'px)';}
        async function up(upEvent){
            document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',up);document.removeEventListener('pointercancel',up);
            var deltaDays=Math.round((upEvent.clientX-startX)/trackWidth*days);bar.style.transform='';
            if(!deltaDays)return;
            try {
                var task=state.tasks.find(function(item){return item.id===taskId;});
                await api('PATCH','/workspaces/'+state.workspace.id+'/tasks/'+taskId,{startDate:addDays(startDate,deltaDays),dueDate:addDays(dueDate,deltaDays),clientRevision:Number(task&&task.revision||1)});
                await loadTasks();toast(t('taskUpdated'),'success');
            } catch(error){toast(apiErrorMessage(error),'error');render();}
        }
        document.addEventListener('pointermove',move);document.addEventListener('pointerup',up);document.addEventListener('pointercancel',up);
    }

    global.JuristWorkspace={
        activate:activate,
        setCurrentUser:setCurrentUser,
        isPreviewMode:function(){return previewMode;},
        openTask:openTask,
        openAi:openAi
    };

    if(document.readyState==='loading') {
        document.addEventListener('DOMContentLoaded',function(){
            root=document.getElementById('workspaceApp');
            if(root&&document.body.dataset.workspaceStandalone==='true')activate();
        });
    } else {
        root=document.getElementById('workspaceApp');
        if(root&&document.body.dataset.workspaceStandalone==='true')activate();
    }
})(window);
