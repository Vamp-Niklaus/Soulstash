const { chromium } = require('playwright');

async function main() {
    const browser = await chromium.launch({
        headless: true
    });

    const context = await browser.newContext({
        userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();

    console.log('Opening IMDb...');

    await page.goto(
        'https://www.imdb.com/hi/name/nm0006795/',
        {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        }
    );

    console.log('Waiting for challenge/page to settle...');

    await page.waitForLoadState('networkidle', {
        timeout: 60000
    }).catch(() => {});

    await page.waitForTimeout(5000);

    console.log('Current URL:', page.url());

    const movies = await page.evaluate(() => {
        const results = [];

        document
            .querySelectorAll(
                'li.ipc-metadata-list-summary-item'
            )
            .forEach(item => {
                const title =
                    item
                        .querySelector(
                            'a.ipc-metadata-list-summary-item__t'
                        )
                        ?.textContent
                        ?.trim() || '';

                const rating =
                    item
                        .querySelector(
                            '.ipc-rating-star--rating'
                        )
                        ?.textContent
                        ?.trim() || '';

                const year =
                    item
                        .querySelector(
                            '.ipc-metadata-list-summary-item__li'
                        )
                        ?.textContent
                        ?.trim() || '';

                if (title) {
                    results.push({
                        title,
                        rating,
                        year
                    });
                }
            });

        return results;
    });

    console.log('\nFound:', movies.length);
    console.log(JSON.stringify(movies, null, 2));

    await browser.close();
}

main().catch(err => {
    console.error(err);
});