const https = require("https");
const cheerio = require("cheerio");
const escapeHTML = require("escape-html");

const COOKIE = process.env.COOKIE;
const RSS_FEED = process.env.RSS_FEED;

const ARTICLES_CACHE = {};

function httpRequest(params, postData) {
  return new Promise(function(resolve, reject) {
    var req = https.request(params, function(res) {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject({
          statusCode: res.statusCode
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
          statusCode: res.statusCode
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

function getArticle({ id, pubDate, url }) {
  if (ARTICLES_CACHE[id]) {
    return Promise.resolve(ARTICLES_CACHE[id]);
  }

  return httpRequest({
    hostname: "www.instapaper.com",
    port: "443",
    path: `/read/${id}`,
    method: "GET",
    headers: {
      Cookie: COOKIE,
      "User-Agent": "node " + process.version
    }
  })
    .then(resp => {
      const $ = cheerio.load(resp.body);

      return {
        id,
        url,
        pubDate,
        title: $("title").text(),
        html: $("#story").html()
      };
    })
    .then(saveToCache);
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

function getList() {
  return Promise.all([
    httpRequest({
      hostname: "www.instapaper.com",
      port: "443",
      path: "/u",
      method: "GET",
      headers: {
        Cookie: COOKIE,
        "User-Agent": "node " + process.version
      }
    }),
    httpRequest(RSS_FEED)
  ]).then(([resp, rssFeed]) => {
    const articles = cheerio("article", resp.body)
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

    return Promise.all(articlesWithDates.map(getArticle));
  });
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

function generate() {
  return getList().then(list =>
    `
      <?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
        <channel>
          <title>Instapaper: Unread</title>
          <link>https://www.instapaper.com/u</link>
          <description></description>

          ${list.map(generateRSSItem).join("\n")}
        </channel>
      </rss>
    `.trim()
  );
}

function gcf(req, res) {
  return generate().then(result => {
    res.status(200).send(result);
  });
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
