import requests

try:
    res = requests.get('http://127.0.0.1:8000/api/ura/conservation-data')
    data = res.json()
    if data['status'] == 'success':
        geojson = data['data']
        print("Type of GeoJSON:", type(geojson))
        if isinstance(geojson, dict):
            print("Keys:", geojson.keys())
            if 'features' in geojson:
                print("Number of features:", len(geojson['features']))
                if len(geojson['features']) > 0:
                    print("First feature properties:", geojson['features'][0].get('properties', {}).keys())
            else:
                print("ERROR: No 'features' array found in the data payload!")
        else:
            print("ERROR: GeoJSON data is not a dictionary.")
    else:
        print("Failed:", data)
except Exception as e:
    print("Exception fetching URA data:", e)
