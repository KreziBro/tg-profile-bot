import {
  Bot,
  Context,
  session,
  SessionFlavor,
  InlineKeyboard,
  webhookCallback,
} from "grammy";

interface SessionData {
  step: "idle" | "waiting_for_idea" | "waiting_for_broadcast";
  promptMsgId?: number;
  lastIdeaTime?: number;
  isBanned?: boolean;
}
type MyContext = Context & SessionFlavor<SessionData>;

export interface Env {
  BOT_TOKEN: string;
  BOT_SESSIONS: KVNamespace;
}

const ADMIN_ID = 0; // Your Telegram ID

function createBot(env: Env) {
  const bot = new Bot<MyContext>(env.BOT_TOKEN);

  bot.use(
    session({
      initial: () => ({ step: "idle" }),
      getSessionKey: (ctx) =>
        ctx.chat?.id ? `user:${ctx.chat.id}` : undefined,
      storage: {
        read: async (key) => {
          const data = await env.BOT_SESSIONS.get(key);
          return data ? JSON.parse(data) : undefined;
        },
        write: async (key, value) => {
          await env.BOT_SESSIONS.put(key, JSON.stringify(value));
        },
        delete: async (key) => {
          await env.BOT_SESSIONS.delete(key);
        },
      },
    })
  );

  const admin = bot.filter((ctx) => ctx.from?.id === ADMIN_ID);

  admin.command("stats", async (ctx) => {
    const list = await env.BOT_SESSIONS.list({ prefix: "user:" });
    await ctx.reply(
      `📊 <b>Статистика бота:</b>\nВсего пользователей: <b>${list.keys.length}</b>`,
      { parse_mode: "HTML" }
    );
  });

  admin.command("send", async (ctx) => {
    ctx.session.step = "waiting_for_broadcast";
    await ctx.reply(
      "Отправьте сообщение для рассылки.\nПоддерживается любое форматирование Telegram, картинки, видео и файлы.\n\nДля отмены: /cancel",
      { parse_mode: "HTML" }
    );
  });

  admin.command("ban", async (ctx) => {
    const id = ctx.match.trim();
    if (!id) return ctx.reply("Формат: /ban ID_пользователя");

    const key = `user:${id}`;
    const data = await env.BOT_SESSIONS.get(key);
    const sess = data ? JSON.parse(data) : { step: "idle" };
    sess.isBanned = true;
    await env.BOT_SESSIONS.put(key, JSON.stringify(sess));

    await ctx.reply(`🚫 Пользователь ${id} забанен.`);
  });

  admin.command("unban", async (ctx) => {
    const id = ctx.match.trim();
    if (!id) return ctx.reply("Формат: /unban ID_пользователя");

    const key = `user:${id}`;
    const data = await env.BOT_SESSIONS.get(key);
    if (data) {
      const sess = JSON.parse(data);
      sess.isBanned = false;
      await env.BOT_SESSIONS.put(key, JSON.stringify(sess));
    }
    await ctx.reply(`✅ Пользователь ${id} разбанен.`);
  });

  admin.on("message", async (ctx, next) => {
    if (ctx.session.step === "waiting_for_broadcast") {
      const list = await env.BOT_SESSIONS.list({ prefix: "user:" });
      let sent = 0;
      await ctx.reply(
        `⏳ Начинаю рассылку для ${list.keys.length} пользователей...`
      );

      for (const key of list.keys) {
        const userId = key.name.split(":")[1];
        if (Number(userId) === ADMIN_ID) continue;
        try {
          await ctx.copyMessage(userId);
          sent++;
        } catch (e) {}
      }
      ctx.session.step = "idle";
      await ctx.reply(`✅ Рассылка завершена! Доставлено: ${sent} чел.`);
      return;
    }

    const replyTo = ctx.message.reply_to_message;
    if (
      replyTo &&
      replyTo.text &&
      replyTo.text.includes("Новое предложение!")
    ) {
      const match = replyTo.text.match(/ID: (\d+)/);
      if (match && match[1]) {
        const userId = match[1];
        try {
          if (ctx.message.text) {
            await ctx.api.sendMessage(
              userId,
              `💬 <b>Ответ:</b>\n\n${ctx.message.text}`,
              { parse_mode: "HTML" }
            );
          } else {
            await ctx.copyMessage(userId);
            await ctx.api.sendMessage(
              userId,
              "💬 <i>(Выше ответ от автора)</i>",
              { parse_mode: "HTML" }
            );
          }
          await ctx.reply("✅ Ответ успешно отправлен пользователю!");
        } catch (e) {
          await ctx.reply(
            "❌ Ошибка отправки. Возможно, юзер заблокировал бота."
          );
        }
        return;
      }
    }
    await next();
  });

  bot.use(async (ctx, next) => {
    if (ctx.session.isBanned) {
      if (ctx.callbackQuery) {
        await ctx.answerCallbackQuery(
          "🚫 Вы забанены в боте и не можете отправлять запросы.",
          { show_alert: true }
        );
      } else if (ctx.message) {
        await ctx.reply(
          "🚫 Вы забанены в боте и не можете использовать его функции."
        );
      }
      return;
    }
    await next();
  });

  const mainText =
    "Привет, я @YourUsername. Делаю всякое, что просто работает."; // Change this to your text

  const mainMenu = new InlineKeyboard()
    .text("Обо мне", "about")
    .text("Ссылки", "links")
    .row()
    .text("Предложить сотрудничество", "collab");

  const aboutMenu = new InlineKeyboard()
    .text("Проекты", "projects")
    .row()
    .text("« Назад", "back");

  const projectsMenu = new InlineKeyboard()
    .url("Проект 1", "https://example.com") // Replace with your projects
    .row()
    .url("Проект 2", "https://example.com")
    .row()
    .url("Проект 3", "https://example.com")
    .row()
    .text("« Назад", "back");

  const linksMenu = new InlineKeyboard()
    .url("Link 1", "https://example.com") // Replace with your links
    .url("Link 2", "https://example.com")
    .row()
    .url("Link 3", "https://example.com")
    .url("Link 4", "https://example.com")
    .row()
    .text("« Назад", "back");

  const cancelMenu = new InlineKeyboard().text("« Назад (Отмена)", "back");

  bot.command("start", async (ctx) => {
    ctx.session.step = "idle";
    await ctx.reply(mainText, { reply_markup: mainMenu });
  });

  bot.command("cancel", async (ctx) => {
    if (
      ctx.session.step === "waiting_for_idea" ||
      ctx.session.step === "waiting_for_broadcast"
    ) {
      ctx.session.step = "idle";
      await ctx.reply("Действие отменено.", { reply_markup: mainMenu });
    } else {
      await ctx.reply("Используйте /start", { reply_markup: mainMenu });
    }
  });

  bot.callbackQuery("back", async (ctx) => {
    await ctx.answerCallbackQuery();
    ctx.session.step = "idle";
    await ctx.editMessageText(mainText, { reply_markup: mainMenu });
  });

  bot.callbackQuery("about", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      "Не люблю рассказывать о себе, лучше смотри, что я сделал.",
      { reply_markup: aboutMenu }
    );
  });

  bot.callbackQuery("projects", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("Мои проекты:", { reply_markup: projectsMenu });
  });

  bot.callbackQuery("links", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("Мои ссылки:", { reply_markup: linksMenu });
  });

  bot.callbackQuery("collab", async (ctx) => {
    await ctx.answerCallbackQuery();

    const now = Date.now();
    const COOLDOWN_MS = 5 * 60 * 1000;
    if (
      ctx.session.lastIdeaTime &&
      now - ctx.session.lastIdeaTime < COOLDOWN_MS
    ) {
      const leftMinutes = Math.ceil(
        (COOLDOWN_MS - (now - ctx.session.lastIdeaTime)) / 60000
      );
      await ctx.editMessageText(
        `⏳ Вы недавно уже отправляли идею. Подождите ещё ${leftMinutes} мин.`,
        { reply_markup: mainMenu }
      );
      return;
    }

    ctx.session.step = "waiting_for_idea";

    if (ctx.callbackQuery.message) {
      ctx.session.promptMsgId = ctx.callbackQuery.message.message_id;
    }

    await ctx.editMessageText(
      "Отправьте свое предложение или опишите идею в одном сообщении!",
      { reply_markup: cancelMenu }
    );
  });

  bot.on("message", async (ctx) => {
    if (ctx.session.step === "waiting_for_idea") {
      const username = ctx.from.username ? `@${ctx.from.username}` : "Скрыт";
      const infoMsg = `💡 <b>Новое предложение!</b>\nОт: <a href="tg://user?id=${ctx.from.id}">${ctx.from.first_name}</a> (${username})\nID: <code>${ctx.from.id}</code>`;

      try {
        await ctx.api.sendMessage(ADMIN_ID, infoMsg, { parse_mode: "HTML" });
        await ctx.forwardMessage(ADMIN_ID);

        if (ctx.session.promptMsgId) {
          try {
            await ctx.api.deleteMessage(
              ctx.chat.id,
              ctx.session.promptMsgId
            );
          } catch (e) {}
        }

        ctx.session.step = "idle";
        ctx.session.lastIdeaTime = Date.now();

        await ctx.reply(
          "Спасибо, я получил ваше сообщение и скоро с вами свяжусь!",
          { reply_markup: mainMenu }
        );
      } catch (err) {
        await ctx.reply("Упс, произошла ошибка при отправке. Попробуйте позже.");
      }
    }
  });

  return bot;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const bot = createBot(env);
    const cb = webhookCallback(bot, "cloudflare-mod");
    return cb(request, env, ctx);
  },
};
