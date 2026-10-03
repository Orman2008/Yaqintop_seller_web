import { appearanceSettings } from "./shared/appearance.js";
import { mountNavigationMotion } from "./shared/motion.js";
import {
  createApiClient,
  resolveApiBaseUrl,
  mediaUrl,
  query,
  rows,
} from "./shared/api.js";
import {
  $,
  esc,
  money,
  heading,
  button,
  empty,
  loading,
  errorView,
  field,
  select,
  textarea,
  dialog,
  submit,
  toast,
} from "./shared/ui.js";
import { authFlow, specializations } from "./shared/auth.js";
import { locationPicker } from "./shared/maps.js";
import { mountChats } from "./shared/chats.js";
import { editAccount, deleteAccount, supportLinks } from "./shared/account.js";
import { sellerTransaction } from "./shared/rewards.js";
import { mountPhotoEditor } from "./shared/photo-navigation.js";
import { productFormData } from "./shared/products.js";
const base = resolveApiBaseUrl(window.MAPMARKET_CONFIG?.PUBLIC_API_BASE_URL);
const api = createApiClient({
  baseUrl: base,
  deviceId: `seller-web:${crypto.randomUUID()}`,
  timeout: 30000,
});
let user = null,
  shop = null,
  shops = [],
  route = "dashboard",
  generation = 0,
  cleanup = () => {},
  tree = {},
  items = [],
  page = 0,
  filter = "",
  importBatch;
const nav = [
  ["dashboard", "Главная"],
  ["products", "Товары"],
  ["catalog", "Каталог MapMarket"],
  ["imports", "Импорт и API"],
  ["chats", "Чаты"],
  ["reviews", "Отзывы"],
  ["broadcasts", "Рассылка"],
  ["qr", "QR / покупатели"],
  ["analytics", "Аналитика"],
  ["plan", "Тариф"],
  ["photo-navigation", "Фото-маршрут"],
  ["store", "Магазин"],
  ["team", "Команда"],
  ["profile", "Аккаунт"],
];
$("#app").outerHTML =
  `<a class="skip-link" href="#view">К содержимому</a><div class="web-shell"><aside class="web-sidebar"><a class="web-brand" href="#dashboard"><img src="assets/mapmarket-logo.png" alt="MapMarket"><span>MapMarket<br><small class="muted">Seller</small></span></a><nav aria-label="Кабинет продавца">${nav.map(([key, title]) => `<a href="#${key}" data-nav="${key}">${title}</a>`).join("")}</nav><div class="sidebar-footer">${supportLinks(base, "seller")}<a href="../buyer/">Покупателям →</a></div></aside><main class="web-main"><header class="web-header"><span id="storeName">Кабинет продавца</span><div class="actions">${button("Войти", "login")}${button("Выйти", "logout")}</div></header><section id="view" class="web-content" aria-live="polite"></section></main></div>`;
const image = (url, title = "Фото товара") => {
  const src = mediaUrl(url, base, true);
  return src
    ? `<img src="${esc(src)}" alt="${esc(title)}" loading="lazy">`
    : "";
};
const endpoint = (suffix) => `/shops/${Number(shop.id)}${suffix}`;
function login() {
  authFlow({
    api,
    client: "seller",
    baseUrl: base,
    locationPicker,
    onSession: async (payload) => {
      user = payload.user;
      shop = payload.shop;
      try {
        if (!shop) {
          const me = await api.request("/users/me");
          user = me.user;
          shop = me.shop;
        }
        shops = rows(await api.request("/users/me/shops"));
        shop = shops.find((s) => Number(s.id) === Number(shop?.id)) || shop;
        await go();
      } catch (error) {
        $("#view").innerHTML = errorView(error);
      }
    },
  });
}
function bindForm(id, task) {
  const form = $(id);
  if (form)
    form.onsubmit = (event) => {
      event.preventDefault();
      submit(form, task);
    };
}
const metricLabels = {
  store_views: "Просмотры магазина",
  product_views: "Просмотры товаров",
  clicks: "Открытия",
  calls: "Звонки",
  routes: "Маршруты",
  catalog_views: "Каталог",
  favorites: "Избранное",
  chats: "Чаты",
  qr_deals: "QR-сделки",
  current_plan: "Текущий тариф",
  product_usage: "Товаров",
  product_limit: "Лимит товаров",
  ai_credits: "AI-кредиты",
  found: "Найдено строк",
  valid: "Корректные строки",
  errors: "Ошибки",
};
let integrationProviders = [];
let analyticsDays = 30;
function infoCards(data) {
  return `<div class="stats">${Object.entries(data || {})
    .filter(([, v]) => typeof v === "number" || typeof v === "string")
    .slice(0, 16)
    .map(
      ([key, value]) =>
        `<article class="card stat"><span class="muted">${esc(metricLabels[key] || key.replaceAll("_", " "))}</span><b>${esc(value)}</b></article>`,
    )
    .join("")}</div>`;
}
function table(values, columns) {
  return values.length
    ? `<div class="table-wrap"><table><thead><tr>${columns.map(([name]) => `<th scope="col">${esc(name)}</th>`).join("")}</tr></thead><tbody>${values.map((item) => `<tr>${columns.map(([, render]) => `<td>${render(item)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
    : empty();
}
function productTable() {
  return table(items, [
    [
      "Товар",
      (p) =>
        `${image(p.image_url, p.title)}<b>${esc(p.title)}</b><p class="muted">${esc(p.barcode || p.gtin || "Без штрихкода")}</p>`,
    ],
    ["Цена", (p) => money(p.price)],
    [
      "Наличие",
      (p) =>
        `<span class="status">${esc(p.stock_status || (p.in_stock ? "AVAILABLE" : "OUT_OF_STOCK"))}</span>`,
    ],
    [
      "Действия",
      (p) =>
        `<div class="actions">${button("Изменить", "edit-product", `data-id="${Number(p.id)}"`)}${button("Наличие", "stock", `data-id="${Number(p.id)}"`)}${button("Удалить", "delete-product", `data-id="${Number(p.id)}"`)}</div>`,
    ],
  ]);
}
async function loadProducts() {
  const version = generation;
  const fetched = rows(
    await api.request(
      `/products?${query({ shop_id: shop.id, q: filter, limit: 24, offset: page * 24 })}`,
    ),
  );
  if (version !== generation) throw new Error("Запрос устарел");
  items = fetched;
  return `${heading("Каталог товаров", shop.name)}<div class="toolbar">${button("Добавить вручную", "new-product")}<form id="productSearch" class="actions">${field("Поиск", "q", filter)}<button class="button">Найти</button></form></div>${productTable()}<div class="actions">${page ? button("Назад", "previous") : ""}${items.length === 24 ? button("Далее", "next") : ""}</div>`;
}
async function editor(product = {}) {
  if (!Object.keys(tree).length)
    tree = await api.request("/products/category-tree");
  const modal = dialog(
    `<form class="form">${field("Название", "title", product.title || "", "text", 'required maxlength="220"')}${textarea("Описание", "description", product.description)}<div class="form-row">${field("Цена, сум", "price", product.price ?? "", "number", 'required min="0.01" step="0.01"')}${field("Старая цена", "old_price", product.old_price || "", "number", 'min="0" step="0.01"')}${field("Скидка, %", "discount_percent", product.discount_percent || 0, "number", 'min="0" max="99" step="0.01"')}</div><div class="form-row">${field("Количество", "stock_quantity", product.stock_quantity ?? "", "number", 'min="0" step="1"')}${select("Наличие", "stock_status", ["AVAILABLE", "OUT_OF_STOCK", "UNCONFIRMED"], product.stock_status || "AVAILABLE")}</div><div class="form-row">${field("Штрихкод / GTIN", "barcode", product.barcode || product.gtin || "", "text", 'inputmode="numeric"')}${field("Артикул", "sku", product.sku || "")}</div><div class="form-row">${field("Бренд", "brand", product.brand || "")}${field("Модель", "model", product.model || "")}</div><details><summary>Варианты и характеристики</summary><div class="form">${field("Цвет", "color", product.color || "")}${field("Размер", "size", product.size || "")}${field("Длина", "length", product.length || "")}${["available_colors", "available_sizes", "unavailable_colors", "unavailable_sizes"].map((key, index) => field(["Цвета через запятую", "Размеры через запятую", "Недоступные цвета", "Недоступные размеры"][index], key, Array.isArray(product[key]) ? product[key].join(", ") : "")).join("")}${textarea("Характеристики JSON", "attributes", typeof product.attributes === "string" ? product.attributes : JSON.stringify(product.attributes || {}))}</div></details>${select("Категория", "category", Object.keys(tree), product.category)}<div id="subcategories"></div>${field("Приложить фото", "image", "", "file", 'accept="image/jpeg,image/png,image/webp"')}<div class="gallery">${(
      product.image_urls || [product.image_url]
    )
      .filter(Boolean)
      .map((url) => image(url))
      .join(
        "",
      )}</div><p class="muted">Фотография загружается в существующее хранилище MapMarket. Удаление фона доступно в Seller App; браузер не запускает мобильный ML-процесс.</p><div class="actions"><button type="button" class="button soft" data-editor-ai="photo">AI: заполнить по фото</button><button type="button" class="button soft" data-editor-ai="description">AI: описание</button></div><p class="muted">Перед AI-запросом покажем стоимость из действующего тарифа. Поля можно проверить до сохранения.</p><button class="button">Сохранить товар</button></form>`,
    product.id ? "Изменить товар" : "Добавить товар",
  );
  const form = $("form", modal),
    category = $("[name=category]", modal);
  function sub() {
    const children = tree[category.value] || {};
    $("#subcategories", modal).innerHTML =
      select(
        "Подкатегория",
        "sub_category",
        Object.keys(children),
        product.sub_category,
      ) + '<div id="leaf"></div>';
    function leaf() {
      const s = $("[name=sub_category]", modal);
      $("#leaf", modal).innerHTML = select(
        "Раздел",
        "leaf_category",
        children[s.value] || [],
        product.leaf_category,
      );
    }
    leaf();
    $("[name=sub_category]", modal).onchange = leaf;
  }
  sub();
  category.onchange = sub;
  if (!product.id) {
    category.closest("label").hidden = true;
    $("#subcategories", modal).hidden = true;
    category
      .closest("label")
      .insertAdjacentHTML(
        "afterend",
        '<p class="muted">Категорию нового товара определяет сервер по названию и описанию. Её можно изменить после сохранения.</p>',
      );
  }
  for (const control of modal.querySelectorAll("[data-editor-ai]"))
    control.onclick = async () => {
      control.disabled = true;
      try {
        const costs = await api.request(
          "/seller-ai/messages?" + query({ shop_id: shop.id }),
        );
        const operation =
          control.dataset.editorAi === "photo"
            ? "product_analysis"
            : "product_description";
        const cost = Number(costs.ai_operation_costs?.[operation]);
        if (!Number.isFinite(cost)) throw new Error("Стоимость AI недоступна");
        if (
          !window.confirm(
            "Запрос использует " + cost + " AI-кредитов. Продолжить?",
          )
        )
          return;
        let result;
        if (operation === "product_analysis") {
          const file = form.elements.image.files[0];
          if (!file) throw new Error("Сначала выберите фото товара");
          const data = new FormData();
          data.append("image", file);
          result = await api.request(endpoint("/ai/analyze-product-image"), {
            method: "POST",
            body: data,
          });
          for (const key of [
            "title",
            "description",
            "brand",
            "model",
            "stock_status",
          ])
            if (result.draft?.[key] != null)
              form.elements[key].value = result.draft[key];
          if (result.draft?.category && tree[result.draft.category]) {
            category.value = result.draft.category;
            sub();
          }
        } else {
          result = await api.request(endpoint("/ai/describe-product"), {
            method: "POST",
            body: {
              title: form.elements.title.value,
              description: form.elements.description.value,
              category: product.id ? category.value : "товар",
            },
          });
          form.elements.description.value = result.description || "";
        }
        toast("Проверьте предложенные AI поля перед сохранением");
      } catch (error) {
        $(".form-error", modal).textContent = error.message;
      } finally {
        control.disabled = false;
      }
    };
  form.onsubmit = (event) => {
    event.preventDefault();
    submit(form, async (values) => {
      const data = productFormData(product, values, shop.id);
      await api.request(
        product.id ? `/products/${Number(product.id)}` : "/products",
        { method: product.id ? "PUT" : "POST", body: data },
      );
      modal.close();
      page = 0;
      route = "products";
      location.hash = "products";
      await go();
      toast("Товар сохранён в MapMarket");
    });
  };
}
async function catalog() {
  return `${heading("Каталог MapMarket", "Общий каталог для всех магазинов")}<form id="lookup" class="toolbar">${field("Штрихкод или название", "q", filter, "text", "required")}<button class="button">Найти</button>${button("Считать камерой", "barcode")}</form><div id="catalogResults">${empty("Введите штрихкод или название")}</div>`;
}
async function lookup(value) {
  filter = value;
  $("#catalogResults").innerHTML = loading();
  try {
    let data;
    if (/^\d{8,14}$/.test(value)) {
      const found = await api.request(
        `/catalog/gtin/${encodeURIComponent(value)}`,
      );
      data = found.product ? [found.product] : rows(found);
    } else
      data = rows(
        await api.request(
          `/seller/catalog/search?${query({ q: value, limit: 24 })}`,
        ),
      );
    $("#catalogResults").innerHTML = table(data, [
      [
        "Товар",
        (p) =>
          `${image(p.canonical_image_url || p.image_url)}<b>${esc(p.canonical_name || p.title)}</b><p>${esc(p.gtin || p.barcode)}</p>`,
      ],
      [
        "Добавить",
        (p) =>
          button(
            "Добавить предложение",
            "offer",
            `data-id="${Number(p.master_product_id || p.id)}"`,
          ),
      ],
    ]);
  } catch (error) {
    $("#catalogResults").innerHTML =
      errorView(error) + button("Добавить новый товар", "new-product");
  }
}
async function imports() {
  const [providers, integrations] = await Promise.all([
    api.request("/api/integrations/providers"),
    api.request(`/api/stores/${shop.id}/integrations`),
  ]);
  integrationProviders = rows(providers);
  return `${heading("Импорт и подключения", "Действующие интеграции из Seller App")}<div class="card"><h2>Excel / CSV</h2><form id="importFile" class="form">${field("Файл", "file", "", "file", 'required accept=".csv,.xlsx,.xls"')}<button class="button">Проверить и посмотреть</button></form><div id="importPreview"></div></div><section class="section"><h2>Интеграции</h2>${table(
    rows(integrations),
    [
      ["Провайдер", (i) => esc(i.provider_name || i.provider)],
      ["Статус", (i) => esc(i.status)],
      [
        "Действия",
        (i) =>
          `<div class="actions">${["test", "connect", "sync", "status", "health", "errors", "sync-history"].map((action) => button(action, "integration", `data-id="${esc(i.id)}" data-operation="${action}"`)).join("")}${button("Отключить", "disconnect", `data-id="${esc(i.id)}"`)}</div>`,
      ],
    ],
  )}</section><section class="card"><h2>Подключить API</h2><form id="integrationCreate" class="form">${select(
    "Провайдер",
    "provider",
    rows(providers)
      .filter(
        (p) =>
          p.is_enabled &&
          p.availability === "available" &&
          p.connection_type !== "file_import",
      )
      .map((p) => [p.code, p.name]),
  )}${textarea("Credentials JSON (не сохраняются в браузере)", "credentials", "{}")}${textarea("Configuration JSON", "configuration", "{}")}<p class="muted">Секреты отправляются только backend и очищаются после запроса. Не вставляйте ключи в адрес сайта.</p><button class="button">Сохранить подключение</button></form></section>`;
}
async function previewImport(values) {
  const data = new FormData();
  data.append("file", values.file);
  importBatch = await api.request(
    `/api/stores/${shop.id}/integration-imports/preview`,
    { method: "POST", body: data },
  );
  $("#importPreview").innerHTML =
    `<p class="notice">Предпросмотр: ${esc(importBatch.summary?.found || importBatch.preview_rows?.length || 0)} строк. До подтверждения товары не импортируются.</p><div class="table-wrap"><table><thead><tr>${importBatch.headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows(
      importBatch,
      "preview_rows",
    )
      .map(
        (row) =>
          `<tr>${(Array.isArray(row) ? row : Object.values(row)).map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`,
      )
      .join(
        "",
      )}</tbody></table></div><form id="importMapping" class="form">${["name", "price", "barcode", "stock_quantity", "image_url", "description"].map((key) => select(key, key, [["", "Не использовать"], ...importBatch.headers], importBatch.suggested_mapping?.[key])).join("")}<button class="button">Проверить сопоставление</button></form><div id="importValidation"></div>`;
  bindForm("#importMapping", async (mapping) => {
    const result = await api.request(
      `/api/stores/${shop.id}/integration-imports/${importBatch.import_id}/mapping`,
      { method: "POST", body: { mapping } },
    );
    $("#importValidation").innerHTML =
      infoCards({
        found: result.found,
        valid: result.valid,
        errors: result.errors_count,
      }) +
      `<p>${esc(rows(result, "first_errors").join("; "))}</p>${result.valid ? button("Подтвердить импорт", "confirm-import") : ""}`;
  });
}
async function storePage() {
  return `${heading("Мой магазин", shop.name)}<div class="card"><form id="storeForm" class="form">${field("Название", "name", shop.name, "text", "required")}${field("Адрес", "address", shop.address, "text", "required")}${field("Телефон", "phone", shop.phone || "", "tel")}${field("Telegram", "telegram", shop.telegram || "")}${field("Часы работы", "working_hours", shop.working_hours || "")}${textarea("Описание", "description", shop.description)}${select("Сфера", "specialization_code", specializations, shop.specialization_code)}<div id="storePicker" class="web-map picker-map"></div><div class="form-row">${field("Широта", "latitude", shop.latitude, "number", 'required step="any" min="-90" max="90"')}${field("Долгота", "longitude", shop.longitude, "number", 'required step="any" min="-180" max="180"')}</div>${field("Логотип", "logo", "", "file", 'accept="image/jpeg,image/png,image/webp"')}<button class="button">Сохранить магазин</button></form></div>`;
}
async function team() {
  const [members, applications] = await Promise.all([
    api.request(endpoint("/team")),
    api.request(endpoint("/staff-applications")),
  ]);
  return `${heading("Команда", "Права проверяются сервером; управление доступно владельцу")}<p class="notice">Код магазина: ${esc(shop.store_code || "Откройте профиль магазина в приложении")}</p>${table(
    rows(members, "members"),
    [
      ["Сотрудник", (m) => esc(m.name || m.user_name)],
      ["Роль", (m) => esc(m.role)],
      [
        "Действия",
        (m) =>
          button("Изменить роль", "team-role", `data-id="${Number(m.id)}"`) +
          button("Удалить доступ", "team-delete", `data-id="${Number(m.id)}"`),
      ],
    ],
  )}<section class="section"><h2>Заявки</h2>${table(
    rows(applications, "applications"),
    [
      ["Имя", (a) => esc(a.name)],
      ["Статус", (a) => esc(a.status)],
      [
        "Действия",
        (a) =>
          (a.status || "pending") === "pending"
            ? button("Одобрить", "approve", `data-id="${Number(a.id)}"`) +
              button("Отклонить", "reject", `data-id="${Number(a.id)}"`)
            : "",
      ],
    ],
  )}</section>`;
}
async function broadcasts() {
  const data = await api.request(endpoint("/broadcasts"));
  return `${heading("Рассылка", `QR-аудитория: ${Number(data.audience_count) || 0}`)}<form id="broadcastForm" class="form card">${textarea("Текст уведомления", "text")}${field("Приложить фото", "image", "", "file", 'accept="image/jpeg,image/png,image/webp"')}<button class="button">Отправить всем</button></form><section class="section"><h2>История рассылок</h2><div class="store-grid">${
    rows(data, "broadcasts")
      .map(
        (b) =>
          `<article class="card">${image(b.media_url, "Фото рассылки")}<p>${esc(b.text)}</p><p class="muted">${esc(b.created_at)} · получателей ${Number(b.recipients_count) || 0}</p></article>`,
      )
      .join("") || empty()
  }</div></section>`;
}
async function go(next = route) {
  route = next;
  const version = ++generation;
  cleanup();
  cleanup = () => {};
  document.title = `${nav.find((n) => n[0] === route)?.[1] || "Кабинет"} · MapMarket Seller`;
  for (const link of document.querySelectorAll("[data-nav]"))
    link.classList.toggle("active", link.dataset.nav === route);
  $("#view").innerHTML = loading();
  $("[data-action=login]").hidden = api.authenticated;
  $("[data-action=logout]").hidden = !api.authenticated;
  if (!api.authenticated) {
    $("#view").innerHTML =
      `${heading("Управляйте магазином в MapMarket", "Тот же аккаунт и каталог, что в Seller App")}<div class="card"><h2>Вход по номеру телефона</h2><p>Код в Telegram или SMS. Владелец создаёт магазин, сотрудник присоединяется по коду магазина.</p>${button("Войти / зарегистрироваться", "login")}</div>`;
    return;
  }
  if (!shop) {
    $("#view").innerHTML = empty("Нет доступного магазина");
    return;
  }
  $("#storeName").innerHTML =
    shops.length > 1
      ? select(
          "Магазин",
          "active_shop",
          shops.map((s) => [s.id, s.name]),
          shop.id,
        )
      : esc(shop.name);
  $("[name=active_shop]")?.addEventListener("change", async (e) => {
    shop = shops.find((s) => Number(s.id) === Number(e.target.value));
    page = 0;
    await go();
  });
  try {
    let html = "";
    if (route === "products") html = await loadProducts();
    else if (route === "catalog") html = await catalog();
    else if (route === "imports") html = await imports();
    else if (route === "store") html = await storePage();
    else if (route === "photo-navigation")
      html =
        heading(
          "Навигация по фото",
          "Тот же маршрут магазина, что в приложении",
        ) + '<div id="photoEditor"></div>';
    else if (route === "team") html = await team();
    else if (route === "broadcasts") html = await broadcasts();
    else if (route === "chats")
      html = heading("Чаты") + '<div id="chatView"></div>';
    else if (route === "reviews") {
      const data = await api.request(endpoint("/reviews/manage"));
      html =
        heading("Отзывы") +
        table(rows(data, "reviews"), [
          ["Покупатель", (r) => esc(r.buyer_name)],
          ["Оценка", (r) => `${Number(r.rating)} ★`],
          ["Текст", (r) => esc(r.text)],
          ["Товар", (r) => esc(r.product_title)],
        ]);
    } else if (route === "dashboard" && shop.position === "seller") {
      html =
        heading("Обзор магазина", shop.name) +
        infoCards({ product_usage: shop.product_count || 0 }) +
        '<p>Расширенная аналитика недоступна вашей роли.</p><a class="button" href="#products">Открыть товары</a>';
    } else if (route === "analytics" || route === "dashboard") {
      const data = await api.request(
        `/analytics/${shop.id}?days=${analyticsDays}`,
      );
      html =
        heading(
          route === "dashboard" ? "Обзор магазина" : "Аналитика",
          `Последние ${analyticsDays} дней · данные сервера`,
        ) +
        infoCards(data.overview || data) +
        `<section class="section"><h2>Популярные товары</h2>${table(
          rows(data, "popular_products"),
          [
            ["Товар", (p) => esc(p.title || p.product_title)],
            ["Просмотры", (p) => esc(p.views ?? p.view_count ?? "—")],
          ],
        )}</section>`;
      if (route === "analytics") {
        html +=
          `<form id="analyticsPeriod" class="toolbar">${select(
            "Период",
            "days",
            [
              [1, "Сегодня"],
              [7, "7 дней"],
              [30, "30 дней"],
              [90, "90 дней"],
              [365, "Год"],
            ],
            analyticsDays,
          )}<button class="button">Показать</button></form>` +
          [
            ["timeline", "Динамика"],
            ["traffic", "Источники"],
            ["search_queries", "Поисковые запросы"],
            ["routes", "Маршруты"],
          ]
            .map(([key, title]) => {
              const entries = rows(data, key);
              if (!entries.length) return "";
              const columns = Object.keys(entries[0])
                .filter((k) => typeof entries[0][k] !== "object")
                .slice(0, 8)
                .map((k) => [
                  metricLabels[k] || k.replaceAll("_", " "),
                  (row) => esc(row[k]),
                ]);
              return (
                '<section class="section"><h2>' +
                title +
                "</h2>" +
                table(entries, columns) +
                "</section>"
              );
            })
            .join("");
      }
    } else if (route === "plan") {
      const data = await api.request(endpoint("/plan"));
      html =
        heading(
          "Тариф и лимиты",
          "Тарифы и ограничения из действующего backend",
        ) +
        infoCards({
          current_plan: data.current_plan || data.plan,
          product_usage: data.product_usage,
          product_limit: data.product_limit,
          ai_credits: data.ai_credits_remaining,
        }) +
        table(
          Array.isArray(data.plans)
            ? data.plans
            : Object.entries(data.plans || {}).map(([name, p]) => ({
                name,
                ...p,
              })),
          [
            ["План", (p) => esc(p.display_name || p.name)],
            [
              "Лимит товаров",
              (p) => esc(p.productLimit ?? p.product_limit ?? p.max_products),
            ],
            ["Стоимость", (p) => money(p.price || p.monthly_price)],
          ],
        ) +
        `<p class="notice">Оплата и тестовое переключение тарифов не добавляются в этом веб-спринте. ${supportLinks(base, "seller")}</p>`;
    } else if (route === "qr") {
      const data = await api.request(endpoint("/qr/customers"));
      html =
        heading("QR-аудитория") +
        `<form id="qrScan" class="form card">${textarea("QR покупателя (текст кода)", "qr_token")}${select(
          "Действие",
          "mode",
          [
            ["subscription", "QR-аудитория"],
            ["transaction", "QR-сделка"],
          ],
        )}${button("Сканировать QR камерой", "barcode", 'data-format="qr"')}<p class="muted">Выберите QR-аудиторию или QR-сделку. В сделке сумма и подтверждение задаются отдельными шагами.</p><button class="button">Принять QR</button></form>` +
        table(rows(data, "customers"), [
          ["Покупатель", (p) => esc(p.name || p.buyer_name)],
          ["Сканирования", (p) => esc(p.total_scans)],
          ["Последнее", (p) => esc(p.last_scanned_at)],
        ]);
    } else if (route === "profile")
      html =
        heading("Аккаунт") +
        appearanceSettings() +
        `<div class="card"><h2>${esc(user.name)}</h2><p>${esc(user.phone)}</p><p class="muted">Роль: ${esc(shop.position || shop.role || user.role)}</p><div class="actions">${button("Редактировать профиль", "account")}${button("Удалить аккаунт", "delete-account")}${button("Выйти", "logout")}</div></div>`;
    else html = empty("Страница не найдена");
    if (version !== generation) return;
    $("#view").innerHTML = html;
    if (route === "chats") {
      const dispose = await mountChats($("#chatView"), {
        api,
        baseUrl: base,
        role: "seller",
      });
      if (version !== generation) dispose();
      else cleanup = dispose;
    }
    if (route === "photo-navigation") {
      const dispose = await mountPhotoEditor($("#photoEditor"), {
        api,
        base,
        shopId: shop.id,
      });
      if (version !== generation) dispose();
      else cleanup = dispose;
    }
    if (route === "store") {
      cleanup = locationPicker(
        $("#storePicker"),
        (p) => {
          $("[name=latitude]").value = p.lat;
          $("[name=longitude]").value = p.lng;
        },
        { lat: Number(shop.latitude), lng: Number(shop.longitude) },
      );
    }
    bindForm("#productSearch", async (values) => {
      filter = values.q;
      page = 0;
      await go();
    });
    bindForm("#analyticsPeriod", async (values) => {
      analyticsDays = [1, 7, 30, 90, 365].includes(Number(values.days))
        ? Number(values.days)
        : 30;
      await go();
    });
    bindForm("#lookup", (values) => lookup(values.q.trim()));
    bindForm("#importFile", previewImport);
    bindForm("#integrationCreate", async (values) => {
      const form = $("#integrationCreate");
      try {
        const credentials = JSON.parse(values.credentials || "{}");
        for (const [key, value] of Object.entries(values))
          if (key.startsWith("credential_")) credentials[key.slice(11)] = value;
        await api.request(`/api/stores/${shop.id}/integrations`, {
          method: "POST",
          body: {
            provider: values.provider,
            credentials,
            configuration: JSON.parse(values.configuration),
          },
        });
        await go();
      } finally {
        if (form?.isConnected) {
          form.elements.credentials.value = "{}";
          form.elements.configuration.value = "{}";
          for (const input of form.querySelectorAll("[type=password]"))
            input.value = "";
        }
      }
    });
    const integrationForm = $("#integrationCreate");
    if (integrationForm) {
      const providerSelect = integrationForm.elements.provider;
      const holder = document.createElement("div");
      holder.className = "form";
      integrationForm.insertBefore(
        holder,
        providerSelect.closest("label").nextSibling,
      );
      const renderProvider = () => {
        const provider = integrationProviders.find(
          (p) => p.code === providerSelect.value,
        );
        holder.innerHTML = `<p class="muted">${esc(provider?.instructions || "")}</p>${rows(
          provider?.configuration_schema,
          "fields",
        )
          .map((descriptor) =>
            field(
              descriptor.label || descriptor.key,
              "credential_" + descriptor.key,
              "",
              descriptor.type === "secret" ? "password" : "text",
              `${descriptor.required ? "required" : ""} autocomplete="off"`,
            ),
          )
          .join("")}`;
      };
      providerSelect.onchange = renderProvider;
      renderProvider();
      const status = document.createElement("section");
      status.className = "section";
      status.innerHTML =
        '<h2>Доступность провайдеров</h2><div class="store-grid">' +
        integrationProviders
          .map(
            (provider) =>
              '<article class="card"><h3>' +
              esc(provider.name) +
              '</h3><span class="status">' +
              esc(provider.availability) +
              "</span><p>" +
              esc(
                provider.blocking_message ||
                  provider.instructions ||
                  provider.description ||
                  "",
              ) +
              "</p></article>",
          )
          .join("") +
        "</div>";
      $("#view").append(status);
    }
    bindForm("#storeForm", async (values) => {
      const data = new FormData();
      for (const [key, value] of Object.entries(values))
        if (key !== "logo") data.append(key, value);
      data.append("specialization", shop.specialization || "");
      if (values.logo?.size) data.append("logo", values.logo);
      const result = await api.request(endpoint(""), {
        method: "PUT",
        body: data,
      });
      shop = { ...shop, ...result.shop };
      await go();
      toast("Магазин сохранён");
    });
    bindForm("#broadcastForm", async (values) => {
      if (!values.text.trim()) throw new Error("Введите текст рассылки");
      let media_url = "";
      if (values.image?.size) {
        const data = new FormData();
        data.append("image", values.image);
        const upload = await api.request("/upload", {
          method: "POST",
          body: data,
        });
        media_url = upload.media_ref || upload.url;
      }
      await api.request(endpoint("/broadcasts"), {
        method: "POST",
        body: { text: values.text, media_url },
      });
      await go();
      toast("Рассылка отправлена");
    });
    bindForm("#qrScan", async (values) => {
      const data = await api.request(endpoint("/rewards/scan"), {
        method: "POST",
        body: { qr_token: values.qr_token.trim(), mode: values.mode },
      });
      if (data.transaction) {
        sellerTransaction(api, shop.id, data.transaction);
        return;
      }
      toast(`QR принят: ${data.customer?.name || "покупатель"}`);
      await go();
    });
  } catch (error) {
    if (version === generation) $("#view").innerHTML = errorView(error);
  }
}
document.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action,
    id = target.dataset.id;
  try {
    if (action === "login") return login();
    if (action === "retry") return go();
    if (action === "logout") {
      await api.logout();
      user = shop = null;
      shops = [];
      return go();
    }
    if (action === "new-product")
      return editor(filter.match(/^\d{8,14}$/) ? { barcode: filter } : {});
    if (action === "edit-product")
      return editor(await api.request(`/products/${Number(id)}`));
    if (action === "delete-product") {
      const modal = dialog(
        `<p>Удалить товар из этого магазина? Он исчезнет из активных предложений покупателям.</p>${button("Удалить товар", "confirm-delete-product", `data-id="${Number(id)}"`)}`,
        "Удалить товар",
      );
      return;
    }
    if (action === "confirm-delete-product") {
      await api.request(`/products/${Number(id)}`, { method: "DELETE" });
      $("dialog").close();
      return go();
    }
    if (action === "stock") {
      const modal = dialog(
        `<form class="form">${select("Наличие", "stock_status", ["AVAILABLE", "OUT_OF_STOCK", "UNCONFIRMED"])}<button class="button">Сохранить</button></form>`,
        "Наличие товара",
      );
      const form = $("form", modal);
      form.onsubmit = (e) => {
        e.preventDefault();
        submit(form, async (values) => {
          await api.request(`/products/${Number(id)}/stock-status`, {
            method: "PUT",
            body: values,
          });
          modal.close();
          await go();
        });
      };
    }
    if (action === "offer") {
      const modal = dialog(
        `<form class="form">${field("Цена, сум", "price", "", "number", 'required min="0.01" step="0.01"')}${field("Количество", "stock_quantity", "", "number", 'min="0" step="1"')}<button class="button">Добавить в магазин</button></form>`,
        "Предложение магазина",
      );
      const form = $("form", modal);
      form.onsubmit = (e) => {
        e.preventDefault();
        submit(form, async (values) => {
          await api.request(endpoint("/catalog-offers"), {
            method: "POST",
            body: { ...values, master_product_id: Number(id) },
          });
          modal.close();
          toast("Предложение добавлено");
        });
      };
    }
    if (action === "next" || action === "previous") {
      page += action === "next" ? 1 : -1;
      return go();
    }
    if (action === "confirm-import") {
      const modal = dialog(
        `<p>Импорт создаст или обновит товары магазина после проверки сопоставления.</p>${button("Начать импорт", "run-import")}`,
        "Подтверждение импорта",
      );
      return;
    }
    if (action === "run-import") {
      await api.request(
        `/api/stores/${shop.id}/integration-imports/${importBatch.import_id}/confirm`,
        { method: "POST", body: {} },
      );
      $("dialog").close();
      $("#importValidation").innerHTML = button(
        "Обновить статус импорта",
        "import-status",
      );
      toast("Импорт поставлен в очередь");
    }
    if (action === "import-status") {
      const data = await api.request(
        `/api/stores/${shop.id}/integration-imports/${importBatch.import_id}/status`,
      );
      $("#importValidation").innerHTML =
        infoCards(data) + button("Обновить статус импорта", "import-status");
    }
    if (action === "integration") {
      const operation = target.dataset.operation;
      const data = await api.request(
        `/api/stores/${shop.id}/integrations/${encodeURIComponent(id)}/${operation}`,
        {
          method: ["test", "connect", "sync"].includes(operation)
            ? "POST"
            : "GET",
          body: ["test", "connect", "sync"].includes(operation)
            ? {}
            : undefined,
        },
      );
      dialog(
        `<pre>${esc(JSON.stringify(data, null, 2))}</pre>`,
        "Результат подключения",
      );
    }
    if (action === "disconnect") {
      dialog(
        `<p>Отключить синхронизацию этой интеграции?</p>${button("Отключить", "confirm-disconnect", `data-id="${esc(id)}"`)}`,
        "Отключение",
      );
    }
    if (action === "confirm-disconnect") {
      await api.request(
        `/api/stores/${shop.id}/integrations/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      $("dialog").close();
      await go();
    }
    if (action === "approve" || action === "reject") {
      dialog(
        `<p>Подтвердить ${action === "approve" ? "одобрение" : "отклонение"} заявки?</p>${button("Подтвердить", "team-application", `data-id="${Number(id)}" data-operation="${action}"`)}`,
        "Заявка сотрудника",
      );
    }
    if (action === "team-application") {
      await api.request(
        endpoint(
          `/staff-applications/${Number(id)}${target.dataset.operation === "approve" ? "/approve" : ""}`,
        ),
        {
          method: target.dataset.operation === "approve" ? "POST" : "DELETE",
          body: target.dataset.operation === "approve" ? {} : undefined,
        },
      );
      $("dialog").close();
      await go();
    }
    if (action === "team-role") {
      const modal = dialog(
        `<form class="form">${select("Роль", "role", ["seller", "manager"])}<button class="button">Сохранить</button></form>`,
        "Права сотрудника",
      );
      const form = $("form", modal);
      form.onsubmit = (e) => {
        e.preventDefault();
        submit(form, async (values) => {
          await api.request(endpoint(`/team/${Number(id)}/role`), {
            method: "PATCH",
            body: values,
          });
          modal.close();
          await go();
        });
      };
    }
    if (action === "team-delete")
      dialog(
        `<p>Удалить доступ сотрудника к магазину?</p>${button("Удалить доступ", "confirm-team-delete", `data-id="${Number(id)}"`)}`,
        "Удаление доступа",
      );
    if (action === "confirm-team-delete") {
      await api.request(endpoint(`/team/${Number(id)}`), { method: "DELETE" });
      $("dialog").close();
      await go();
    }
    if (action === "account")
      editAccount(api, user, (value) => {
        user = value;
        go();
      });
    if (action === "delete-account")
      deleteAccount(api, () => {
        user = shop = null;
        go();
      });
    if (action === "barcode") {
      if (!window.BarcodeDetector)
        throw new Error(
          "Этот браузер не поддерживает чтение штрихкода камерой. Введите GTIN вручную или используйте Seller App.",
        );
      const qr = target.dataset.format === "qr";
      const modal = dialog(
        '<video autoplay playsinline muted style="width:100%"></video><p>Наведите камеру на штрихкод</p>',
        "Штрихкод",
      );
      let stream,
        stopped = false,
        timer;
      modal.addEventListener("close", () => {
        stopped = true;
        clearTimeout(timer);
        stream?.getTracks().forEach((t) => t.stop());
      });
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const video = $("video", modal);
      video.srcObject = stream;
      const detector = new BarcodeDetector({
        formats: qr
          ? ["qr_code"]
          : ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"],
      });
      const scan = async () => {
        if (stopped) return;
        try {
          const found = await detector.detect(video);
          if (found[0]) {
            const code = found[0].rawValue;
            modal.close();
            if (qr) {
              $("[name=qr_token]").value = code;
              return;
            }
            $("[name=q]").value = code;
            await lookup(code);
            return;
          }
        } catch {}
        timer = setTimeout(scan, 300);
      };
      scan();
    }
  } catch (error) {
    toast(error.message);
  }
});
$(".skip-link").onclick = (event) => {
  event.preventDefault();
  $("#view").tabIndex = -1;
  $("#view").focus();
};
mountNavigationMotion(document.querySelector(".web-sidebar nav"));
window.addEventListener("hashchange", () =>
  go(location.hash.slice(1) || "dashboard"),
);
window.addEventListener("offline", () =>
  toast("Нет соединения. Изменения ещё не отправлены на сервер."),
);
go(location.hash.slice(1) || "dashboard");
