const AllDebridClient = require('all-debrid-api');
const isVideo = require('../lib/video');
const StaticResponse = require('./static');
const { getRandomProxy, getRandomUserAgent } = require('../lib/request_helper');
const { cacheWrapResolvedUrl, cacheWrapProxy, cacheUserAgent } = require('../lib/cache');

async function getCachedStreams(streams, apiKey) {
  const options = await getDefaultOptions(apiKey);
  const AD = new AllDebridClient(apiKey, options);
  const hashes = streams.map(stream => stream.infoHash);
  const available = await AD.magnet.instant(hashes)
      .catch(error => {
        console.warn('Failed AllDebrid cached torrent availability request: ', error);
        return undefined;
      });
  return available && available.data && streams
      .reduce((mochStreams, stream) => {
        const cachedEntry = available.data.magnets.find(magnet => stream.infoHash === magnet.hash.toLowerCase());
        const streamTitleParts = stream.title.replace(/\n👤.*/s, '').split('\n');
        const fileName = streamTitleParts[streamTitleParts.length - 1];
        const fileIndex = streamTitleParts.length === 2 ? stream.fileIdx : null;
        const encodedFileName = encodeURIComponent(fileName);
        mochStreams[stream.infoHash] = {
          url: `${apiKey}/${stream.infoHash}/${encodedFileName}/${fileIndex}`,
          cached: cachedEntry && cachedEntry.instant
        }
        return mochStreams;
      }, {})
}

async function resolve({ ip, apiKey, infoHash, cachedEntryInfo, fileIndex }) {
  console.log(`Unrestricting ${infoHash} [${fileIndex}]`);
  const options = await getDefaultOptions(apiKey, ip);
  const AD = new AllDebridClient(apiKey, options);
  const torrent = await _createOrFindTorrent(AD, infoHash);
  if (torrent && statusReady(torrent.statusCode)) {
    return _unrestrictLink(AD, torrent, cachedEntryInfo, fileIndex);
  } else if (torrent && statusDownloading(torrent.statusCode)) {
    return StaticResponse.DOWNLOADING;
  } else if (torrent && statusHandledError(torrent.statusCode)) {
    return _retryCreateTorrent(AD, infoHash, cachedEntryInfo, fileIndex);
  } else if (torrent && errorExpiredSubscriptionError(torrent)) {
    return StaticResponse.FAILED_ACCESS;
  }
  return Promise.reject("Failed AllDebrid adding torrent");
}

async function _createOrFindTorrent(AD, infoHash) {
  return _findTorrent(AD, infoHash)
      .catch(() => _createTorrent(AD, infoHash))
      .catch(error => {
        console.warn('Failed AllDebrid torrent retrieval', error);
        return error;
      });
}

async function _retryCreateTorrent(AD, infoHash, encodedFileName, fileIndex) {
  const newTorrentId = await _createTorrent(AD, infoHash);
  const newTorrent = await AD.magnet.status(newTorrentId);
  return newTorrent && statusReady(newTorrent.statusCode)
      ? _unrestrictLink(AD, newTorrent, encodedFileName, fileIndex)
      : StaticResponse.FAILED_DOWNLOAD;
}

async function _findTorrent(AD, infoHash) {
  const torrents = await AD.magnet.status().then(response => response.data.magnets);
  const foundTorrents = torrents.filter(torrent => torrent.hash.toLowerCase() === infoHash);
  const nonFailedTorrent = foundTorrents.find(torrent => !statusError(torrent.statusCode));
  const foundTorrent = nonFailedTorrent || foundTorrents[0];
  return foundTorrent || Promise.reject('No recent torrent found');
}

async function _createTorrent(AD, infoHash) {
  const uploadResponse = await AD.magnet.upload(infoHash);
  const torrentId = uploadResponse.data.magnets[0].id;
  return AD.magnet.status(torrentId).then(statusResponse => statusResponse.data.magnets);
}

async function _unrestrictLink(AD, torrent, encodedFileName, fileIndex) {
  const targetFileName = decodeURIComponent(encodedFileName);
  const videos = torrent.links.filter(link => isVideo(link.filename));
  const targetVideo = Number.isInteger(fileIndex)
      ? videos.find(video => targetFileName.includes(video.filename))
      : videos.sort((a, b) => b.size - a.size)[0];

  if (!targetVideo.link || !targetVideo.link.length) {
    return Promise.reject("No available links found");
  }
  const unrestrictedLink = await AD.link.unlock(targetVideo.link).then(response => response.data.link);
  console.log(`Unrestricted ${torrent.hash} [${fileIndex}] to ${unrestrictedLink}`);
  return unrestrictedLink;
}

async function getDefaultOptions(id, ip) {
  const userAgent = await cacheUserAgent(id, () => getRandomUserAgent()).catch(() => getRandomUserAgent());
  const proxy = await cacheWrapProxy('moch', () => getRandomProxy()).catch(() => getRandomProxy());

  return { proxy: proxy, headers: { 'User-Agent': userAgent } };
}

function statusError(statusCode) {
  return [5, 6, 7, 8, 9, 10, 11].includes(statusCode)
}

function statusHandledError(statusCode) {
  return [5, 7, 9, 10].includes(statusCode)
}

function statusDownloading(statusCode) {
  return [0, 1, 2, 3].includes(statusCode)
}

function statusReady(statusCode) {
  return statusCode === 4;
}

function errorExpiredSubscriptionError(error) {
  return ['You must be premium to use this feature', 'You must be premium to process this link']
      .includes(error.message);
}

module.exports = { getCachedStreams, resolve };