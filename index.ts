import express from 'express'
import fetch from 'node-fetch'
import lodash from 'lodash'
import dotenv from 'dotenv';
dotenv.config()

const PORT = 80;
const TOKEN = process.env.API_TOKEN;
const NUM_PLAYERS_TO_FETCH = 10;

if (!TOKEN) {
    throw new Error('No API_TOKEN var found in env vars')
}
const app = express();
const CACHE_MAX_STALENESS_MS = 1000 * 60 * 60 * 24 * 7; // 1wk in ms
let cache: any = undefined;
let cacheUpdateTime: number = 0;


const CLASH_ROYALE_API_ROOT = `https://api.clashroyale.com/v1`;
async function makeClashRoyaleApiReq(endpoint: string): Promise<any> {
    const res = await fetch(`${CLASH_ROYALE_API_ROOT}/${endpoint}`, {
        method: 'GET',
        headers: {
            "authorization": `Bearer ${TOKEN}`,
            "content-type": "application/json"
        }
    })

    if (res.ok) {
        return await res.json()
    } else {
        console.error(res)
        throw new Error(`Response to api request (${endpoint}) was not rad`)
    }
}

// At some point this will break as their api will begin to use pagination which this
// does not understand. Likely that will happen in decades tho.
async function getCurrentSeason(): Promise<string> {
    const seasonsData = await makeClashRoyaleApiReq('locations/global/seasons')
    const seasonsList = seasonsData.items;
    if (!seasonsList || !Array.isArray(seasonsList) || seasonsList.length === 0) {
        throw new Error('Malformed response from seasons list api')
    }
    const mostRecentSeasonId = seasonsData.items[seasonsData.items.length - 1].id
    return mostRecentSeasonId
}

// gets 10k from api, but only returns 1k as per spec
type PlayerRank = {
    tag: string,
    name: string,
    expLevel: number,
    trophies: number,
    rank: number,
    clan: any
}
async function getPlayerRankingsForMostRecentSeason(): Promise<PlayerRank[]> {
    const seasonId = await getCurrentSeason();

    const rankingsData = await makeClashRoyaleApiReq(`locations/global/seasons/${seasonId}/rankings/players`)
    const rankings = rankingsData.items;
    if (!rankings || !Array.isArray(rankings) || rankings.length === 0) {
        throw new Error('Malformed response from rankings list api')
    }
    return lodash.take(rankings, NUM_PLAYERS_TO_FETCH);
}

async function getPlayerData(tag: string): Promise<any> {
    const encodedTag = encodeURIComponent(tag)
    const playerData = await makeClashRoyaleApiReq(`players/${encodedTag}`)
    if (!playerData ) {
        throw new Error('Malformed response from player data api')
    }
    return playerData
}

function formatPlayerData(player: any) {
    return {
        name: player.name,
        currentDeck: player.currentDeck,
        leagueStatistics: player.leagueStatistics,
    }
}

async function populateCache(): Promise<void> {
    const rankings = await getPlayerRankingsForMostRecentSeason();
    const playerData = await Promise.all(rankings.map(player => getPlayerData(player.tag)));
    const formattedPlayerData = playerData.map(formatPlayerData);

    cache = lodash.sortBy(formattedPlayerData, 'leagueStatistics.currentSeason.rank');
    cacheUpdateTime = new Date().getTime();
}

function isCacheStale() {
    return new Date().getTime() - cacheUpdateTime > CACHE_MAX_STALENESS_MS
}

app.get('/detailedLeaderboard', async (req, res) => {
    if (!cache || isCacheStale()) {
        console.log('updating cache')
        await populateCache();
        console.log('done updating cache')
    }
    res.send(cache)
});

app.listen(PORT, () => {
  console.log(`⚡️[server]: Server is running at https://localhost:${PORT}`);
});