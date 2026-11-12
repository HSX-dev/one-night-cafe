/** 图片预加载，逐个回调进度。单张失败不阻塞进入游戏（记录下来即可）。 */
export async function preloadImages(urls, onProgress) {
  let done = 0;
  const failed = [];
  await Promise.all(
    urls.map(
      (url) =>
        new Promise((resolve) => {
          const img = new Image();
          img.decoding = 'async';
          img.onload = img.onerror = (e) => {
            if (e.type === 'error') failed.push(url);
            done++;
            onProgress(done, urls.length);
            resolve();
          };
          img.src = url;
        }),
    ),
  );
  return { failed };
}
