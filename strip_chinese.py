import os
import re

dirs_to_check = ['src', 'tests', 'scripts', '.']
extensions = ['.ts', '.tsx', '.json', '.md', '.js', '.jsx', '.html', '.css']

# Matches Chinese characters and common full-width punctuation
chinese_regex = re.compile(r'[\u4e00-\u9fa5\u3000-\u303F\uFF00-\uFFEF]+')
files_touched = 0

for d in dirs_to_check:
    if d == '.':
        # process root files
        root_files = [f for f in os.listdir('.') if os.path.isfile(f)]
        paths = [f for f in root_files]
    else:
        paths = []
        for root, dirs, files in os.walk(d):
            # skip node_modules
            if 'node_modules' in root.split(os.sep): continue
            for f in files:
                paths.append(os.path.join(root, f))
                
    for path in paths:
        if not any(path.endswith(ext) for ext in extensions):
            continue
            
        try:
            with open(path, 'r', encoding='utf-8') as file:
                content = file.read()
        except UnicodeDecodeError:
            continue
            
        if chinese_regex.search(content):
            new_content = chinese_regex.sub('', content)
            with open(path, 'w', encoding='utf-8') as file:
                file.write(new_content)
            files_touched += 1
            print(f"Stripped Chinese text from {path}")

print(f"Done. Touched {files_touched} files.")
