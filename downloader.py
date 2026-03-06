import cloudscraper
import requests
import sys
import os
import zipfile
import re

API="https://comix.to/api/v2  "

scraper = cloudscraper.create_scraper(
    browser={
        "browser":"chrome",
        "platform":"windows",
        "mobile":False
    }
)

HEADERS = {
    "Referer": "https://comix.to/  ",
    "User-Agent": "Mozilla/5.0"
}

def extract_code(url):
    slug=url.rstrip("/").split("/")[-1]
    return slug.split("-")[0]

def safe(s):
    return re.sub(r"[^a-zA-Z0-9]+","_",s)[:100]

def get_json(url):
    r=scraper.get(url)
    r.raise_for_status()
    return r.json()

def download(url,path):

    r=scraper.get(url,stream=True, headers=HEADERS)
    r.raise_for_status()

    with open(path,"wb") as f:
        for chunk in r.iter_content(8192):
            f.write(chunk)

def main():

    url=sys.argv[1]
    code=extract_code(url)

    os.makedirs("output",exist_ok=True)

    print("Fetching manga info...")

    manga=get_json(f"{API}/manga/{code}/")["result"]

    name=safe(manga["title"])
    base=f"output/{name}"

    os.makedirs(base,exist_ok=True)

    print("Fetching chapters...")

    page=1
    chapters=[]

    while True:

        data=get_json(f"{API}/manga/{code}/chapters?limit=100&page={page}&order[number]=asc")

        items=data["result"]["items"]

        if not items:
            break

        chapters+=items

        if len(items)<100:
            break

        page+=1

    # remove duplicate chapter numbers
    uniq={}

    for c in chapters:
        n=c["number"]
        if n not in uniq:
            uniq[n]=c

    chapters=sorted(uniq.values(),key=lambda x: float(x["number"]))

    print("Total chapters:",len(chapters))

    for ch in chapters:

        num=ch["number"]
        cid=ch["chapter_id"]

        print("Downloading chapter",num)

        data=get_json(f"{API}/chapters/{cid}/")

        images=data["result"]["images"]

        chap_dir=f"{base}/Chapter_{num}"
        os.makedirs(chap_dir,exist_ok=True)

        for i,img in enumerate(images,1):

            img_url=img["url"]
            ext=img_url.split(".")[-1].split("?")[0]

            file=f"{chap_dir}/{i:03}.{ext}"

            if os.path.exists(file):
                continue

            try:
                download(img_url,file)
            except:
                print("failed",img_url)

    zip_path=f"output/{name}.zip"

    print("Creating zip...")

    with zipfile.ZipFile(zip_path,"w",zipfile.ZIP_DEFLATED) as z:

        for root,dirs,files in os.walk(base):
            for f in files:
                full=os.path.join(root,f)
                rel=os.path.relpath(full,base)
                z.write(full,rel)

    print("Done:",zip_path)

if __name__=="__main__":
    main()
