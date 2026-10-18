// Existing workflow regressions use the real API. Dismiss the optional first-login
// walkthrough through its real control so it cannot obscure an unrelated form.
// Dedicated guidance tests verify its content, progress and first-login behavior.
export async function newFixturePage(browser, options) {
  const page = await browser.newPage(options);
  const guide = page.getByRole('dialog', {name:'Welcome to Property Flow',exact:true});
  await page.addLocatorHandler(guide, async () => { await guide.getByRole('button',{name:'Skip for now',exact:true}).click(); });
  return page;
}
