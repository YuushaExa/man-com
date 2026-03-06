import asyncio
import sys
import os
import zipfile
import re
from playwright.async_api import async_playwright

API = "https://comix.to/api/v2"

def extract_code(url):
    slug = url.rstrip("/").split("/")[-1]
    return slug.split("-")[0]

def safe(s):
    return re.sub(r"[^a-zA-Z0-9]+","_",s)[:100]

async def main():

    url = sys.argv[1]
    code = extract_code(url)

    os.makedirs("output", exist_ok=True)

    async with async_playwright() as p:

        browser = await p.chromium.launch()
        page = await browser.new_page()

        print("Opening manga page to pass Cloudflare...")
        await page.goto(url)
        await page.wait_for_timeout(5000)

        print("Fetching manga info...")

        manga = await page.evaluate(f"""
            async () => {{
                const r = await fetch("{API}/manga/{code}/");
                return await r.json();
            }}
        """)

        manga = manga["result"]
        manga_name = safe(manga["title"])

        base_dir = f"output/{manga_name}"
        os.makedirs(base_dir, exist_ok=True)

        print("Fetching chapters...")

        page_num = 1
        chapters = []

        while True:

            data = await page.evaluate(f"""
                async () => {{
                    const r = await fetch("{API}/manga/{code}/chapters?limit=100&page={page_num}&order[number]=asc");
                    return await r.json();
                }}
            """)

            items = data["result"]["items"]

            if not items:
                break

            chapters.extend(items)

            if len(items) < 100:
                break

            page_num += 1

        # remove duplicates
        unique = {}
        for ch in chapters:
            num = ch["number"]
            if num not in unique:
                unique[num] = ch

        chapters = sorted(unique.values(), key=lambda x: float(x["number"]))

        print("Total chapters:", len(chapters))

        for ch in chapters:

            num = ch["number"]
            chap_id = ch["chapter_id"]

            print("Downloading chapter", num)

            data = await page.evaluate(f"""
                async () => {{
                    const r = await fetch("{API}/chapters/{chap_id}/");
                    return await r.json();
                }}
            """)

            images = data["result"]["images"]

            chap_dir = f"{base_dir}/Chapter_{num}"
            os.makedirs(chap_dir, exist_ok=True)

            for i,img in enumerate(images,1):

                img_url = img["url"]
                ext = img_url.split(".")[-1].split("?")[0]
                filename = f"{chap_dir}/{i:03}.{ext}"

                try:
                    await page.goto(img_url)
                    content = await page.content()

                    async with page.expect_download():
                        pass

                except:
                    print("failed", img_url)

        zip_path = f"output/{manga_name}.zip"

        print("Creating zip...")

        with zipfile.ZipFile(zip_path,"w",zipfile.ZIP_DEFLATED) as z:
            for root,_,files in os.walk(base_dir):
                for f in files:
                    full=os.path.join(root,f)
                    rel=os.path.relpath(full,base_dir)
                    z.write(full,rel)

        print("Done:", zip_path)

        await browser.close()

asyncio.run(main())
