import requests
import os
import sys
import zipfile
from urllib.parse import urlparse

HEADERS = {
    "Referer": "https://comix.to/",
    "User-Agent": "Mozilla/5.0"
}

API = "https://comix.to/api/v2"

def extract_code(url):
    slug = url.rstrip("/").split("/")[-1]
    return slug.split("-")[0]

def safe(s):
    return "".join(c if c.isalnum() else "_" for c in s)[:100]

def fetch_json(url):
    r = requests.get(url, headers=HEADERS)
    r.raise_for_status()
    return r.json()

def download_file(url, path):
    r = requests.get(url, headers=HEADERS, stream=True)
    r.raise_for_status()
    with open(path, "wb") as f:
        for chunk in r.iter_content(8192):
            f.write(chunk)

def main():

    manga_url = sys.argv[1]
    code = extract_code(manga_url)

    print("Fetching manga info...")
    manga = fetch_json(f"{API}/manga/{code}/")["result"]

    manga_name = safe(manga["title"])
    base_dir = f"output/{manga_name}"
    os.makedirs(base_dir, exist_ok=True)

    print("Fetching chapters...")

    page = 1
    chapters = []

    while True:
        data = fetch_json(f"{API}/manga/{code}/chapters?limit=100&page={page}&order[number]=asc")
        items = data["result"]["items"]
        if not items:
            break
        chapters.extend(items)
        if len(items) < 100:
            break
        page += 1

    # remove duplicates by chapter number
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

        chap_dir = f"{base_dir}/Chapter_{num}"
        os.makedirs(chap_dir, exist_ok=True)

        print("Downloading chapter", num)

        data = fetch_json(f"{API}/chapters/{chap_id}/")
        images = data["result"]["images"]

        for i, img in enumerate(images, start=1):

            url = img["url"]
            ext = url.split(".")[-1].split("?")[0]

            filename = f"{chap_dir}/{i:03}.{ext}"

            if os.path.exists(filename):
                continue

            try:
                download_file(url, filename)
            except Exception as e:
                print("failed", url)

    zip_path = f"output/{manga_name}.zip"

    print("Creating zip...")

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for root, dirs, files in os.walk(base_dir):
            for file in files:
                full = os.path.join(root, file)
                rel = os.path.relpath(full, base_dir)
                z.write(full, rel)

    print("Done:", zip_path)

if __name__ == "__main__":
    main()
