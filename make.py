import asyncio, json, os, edge_tts
async def main():
    os.makedirs('si_edge', exist_ok=True)
    for k, t in json.load(open('clips.json', encoding='utf-8')).items():
        for attempt in range(4):
            try:
                await edge_tts.Communicate(t, 'si-LK-ThiliniNeural', rate='-5%').save(f'si_edge/{k}.mp3'); break
            except Exception as e:
                print('retry', k, e); await asyncio.sleep(3)
        print(k, os.path.getsize(f'si_edge/{k}.mp3'))
asyncio.run(main())
