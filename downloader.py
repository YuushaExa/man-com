import os
import requests
import cloudscraper
import zipfile
import time

API = "https://comix.to/api/v2"

HEADERS = {
    "Referer": "https://comix.to/",
    "Origin": "https://comix.to",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
}

scraper = cloudscraper.create_scraper()


def fetch_json(url):
    r = scraper.get(url, headers=HEADERS)
    r.raise_for_status()
    return r.json()


def download_image(url, path, retries=3):
    for i in range(retries):
        try:
            r = scraper.get(url, headers=HEADERS, stream=True, timeout=30)

            if r.status_code == 200:
                with open(path, "wb") as f:
                    for chunk in r.iter_content(8192):
                        if chunk:
                            f.write(chunk)
                return True

        except Exception:
            pass

        time.sleep(2)

    print("failed", url)
    return False


def zip_manga(folder):
    zip_name = f"{folder}.zip"

    with zipfile.ZipFile(zip_name, "w", zipfile.ZIP_DEFLATED) as z:
        for root, dirs, files in os.walk(folder):
            for file in files:
                path = os.path.join(root, file)
                z.write(path)

    print("Created zip:", zip_name)


def main():
    code = os.environ.get("MANGA_CODE")

    if not code:
        print("Missing MANGA_CODE env variable")
        return

    print("Fetching manga info...")
    manga = fetch_json(f"{API}/manga/{code}/")["result"]

    title = manga["title"]
    manga_folder = title.replace("/", "_")

    os.makedirs(manga_folder, exist_ok=True)

    print("Fetching chapters...")
    chapters = fetch_json(f"{API}/chapter?manga={code}")["results"]

    print("Total chapters:", len(chapters))

    for ch in chapters:
        chap_num = ch["number"]
        chap_id = ch["hid"]

        chap_folder = os.path.join(manga_folder, f"chapter_{chap_num}")
        os.makedirs(chap_folder, exist_ok=True)

        print("Downloading chapter", chap_num)

        pages = fetch_json(f"{API}/chapter/{chap_id}")["result"]["pages"]

        for i, page in enumerate(pages, start=1):
            img_url = page["url"]

            filename = f"{i:03}.webp"
            path = os.path.join(chap_folder, filename)

            if os.path.exists(path):
                continue

            ok = download_image(img_url, path)

            if not ok:
                print("failed", img_url)

    zip_manga(manga_folder)


if __name__ == "__main__":
    main()
