const https = require("https");
const cheerio = require("cheerio");
const escapeHTML = require("escape-html");

let COOKIE = process.env.COOKIE;
const ARTICLES_CACHE = {};

async function httpRequest(params, postData) {
  return new Promise(function(resolve, reject) {
    var req = https.request(params, function(res) {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject({
          statusCode: res.statusCode,
          headers: res.headers
        });
      }
      var body = [];
      res.on("data", function(chunk) {
        body.push(chunk);
      });
      res.on("end", function() {
        try {
          body = Buffer.concat(body).toString();
        } catch (e) {
          reject(e);
        }
        resolve({
          body,
          statusCode: res.statusCode,
          headers: res.headers
        });
      });
    });

    req.on("error", function(err) {
      reject(err);
    });
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

function saveToCache(article) {
  ARTICLES_CACHE[article.id] = article;

  return article;
}

async function getArticle(cookie, { id, pubDate, url }) {
  if (ARTICLES_CACHE[id]) {
    return ARTICLES_CACHE[id];
  }

  let resp;

  try {
    resp = await httpRequest({
      hostname: "www.instapaper.com",
      port: "443",
      path: `/read/${id}`,
      method: "GET",
      headers: {
        Cookie: cookie,
        "User-Agent": "node " + process.version
      }
    });
  } catch (e) {
    if (
      e &&
      e.statusCode === 302 &&
      e.headers["location"] &&
      ~e.headers["location"].indexOf(`?parse_error=${id}`)
    ) {
      return saveToCache({
        id,
        url,
        pubDate,
        title: url,
        html: "parse_error"
      });
    }

    console.error(e);

    return {
      id,
      url,
      pubDate,
      title: url,
      html: JSON.stringify(e)
    };
  }

  const $ = cheerio.load(resp.body);

  return saveToCache({
    id,
    url,
    pubDate,
    title: $("title").text(),
    html: $("#story").html()
  });
}

function getArticleFromListCheerio(i, el) {
  const article = cheerio(el);
  return {
    id: article.attr("data-article-id"),
    url: article.find(".title_meta .js_domain_linkout").attr("href")
  };
}

function getArticleFromRSSCheerio(i, el) {
  const item = cheerio(el);
  return {
    guid: item.find("guid").text(),
    pubDate: item.find("pubDate").text()
  };
}

function extendWithPubDate(acc, { guid, pubDate }) {
  acc[guid] = pubDate;
  return acc;
}

async function getList(cookie) {
  const resp = await httpRequest({
    hostname: "www.instapaper.com",
    port: "443",
    path: "/u",
    method: "GET",
    headers: {
      Cookie: cookie,
      "User-Agent": "node " + process.version
    }
  });

  const $ = cheerio.load(resp.body);
  const rssFeedPath = $('link[type="application/rss+xml"]').attr("href");

  const rssFeed = await httpRequest({
    hostname: "www.instapaper.com",
    port: "443",
    path: rssFeedPath,
    method: "GET"
  });

  const articles = $("article")
    .map(getArticleFromListCheerio)
    .get();

  const dates = cheerio("item", rssFeed.body)
    .map(getArticleFromRSSCheerio)
    .get()
    .reduce(extendWithPubDate, {});

  const articlesWithDates = articles
    .filter(article => dates[article.url])
    .map(article => ((article.pubDate = dates[article.url]), article))
    .slice(0, 5);

  return Promise.all(
    articlesWithDates.map(article => getArticle(cookie, article))
  );
}

function generateRSSItem(item) {
  return `
    <item>
      <guid>${item.url}</guid>
      <title>${escapeHTML(item.title)}</title>
      <link>${item.url}</link>
      <description>${escapeHTML(item.html).trim()}</description>
      <pubDate>${item.pubDate}</pubDate>
    </item>
  `.trim();
}

function getCookiePart(setCookieHeader) {
  const match = setCookieHeader.match(/^(pfp|pfu|pfh)=([^;]+);/);

  if (match) {
    return match[1] + "=" + match[2];
  }
}

async function getInstapaperCookie(username, password) {
  try {
    await httpRequest(
      {
        hostname: "www.instapaper.com",
        port: "443",
        path: "/user/login",
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=utf-8"
        }
      },
      `username=${encodeURIComponent(username)}&password=${encodeURIComponent(
        password
      )}`
    );
  } catch (resp) {
    if (
      resp &&
      resp.statusCode === 302 &&
      resp.headers &&
      resp.headers["set-cookie"]
    ) {
      COOKIE = resp.headers["set-cookie"]
        .map(getCookiePart)
        .filter(Boolean)
        .join("; ");

      return COOKIE;
    }

    throw resp;
  }
}

async function generate() {
  const cookie =
    COOKIE ||
    (await getInstapaperCookie(process.env.USERNAME, process.env.PASSWORD));
  const list = await getList(cookie);

  return `
    <?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
      <channel>
        <title>Instapaper: Unread</title>
        <link>https://www.instapaper.com/u</link>
        <description></description>

        ${list.map(generateRSSItem).join("\n")}
      </channel>
    </rss>
  `.trim();
}

async function gcf(req, res) {
  return res.status(200).send(await generate());
}

if (require.main === module) {
  generate()
    .then(result => {
      console.log(result);
      process.exit(0);
    })
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
} else {
  module.exports = {
    generate,
    gcf
  };
}
