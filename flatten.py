import os
import shutil

client_dir = "client"
for item in os.listdir(client_dir):
    source = os.path.join(client_dir, item)
    destination = os.path.join(".", item)
    if os.path.exists(destination):
        if os.path.isdir(destination):
            shutil.rmtree(destination)
        else:
            os.remove(destination)
    shutil.move(source, destination)

os.rmdir(client_dir)
print("Successfully flattened the repository.")
