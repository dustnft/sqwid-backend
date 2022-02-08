const ethers = require ('ethers');
const { Router } = require ('express');
// const collectibleContractABI = require ('../../../contracts/SqwidERC1155').ABI;
const marketplaceContractABI = require ('../../../contracts/SqwidMarketplace').ABI;
const axios = require ('axios');
const { getWallet } = require ('../../../lib/getWallet');
const { byId } = require ('../collections');
const getNetwork = require ('../../../lib/getNetwork');
const firebase = require ('../../../lib/firebase');
const { FieldPath } = require ('firebase-admin').firestore;
// const collectibleContract = (signerOrProvider, address = null) => new ethers.Contract (address || getNetwork ().contracts ['erc1155'], collectibleContractABI, signerOrProvider);
const marketplaceContract = (signerOrProvider) => new ethers.Contract (getNetwork ().contracts ['marketplace'], marketplaceContractABI, signerOrProvider);

const getNameByEVMAddress = async (address) => {
    const res = await firebase.collection ('users').where ('evmAddress', '==', address).get ();
    if (!res.empty) return res.docs [0].data ().displayName;
    else return address;
}

const getSaleData = item => {
    return {
        price: Number (item.price)
    }
}

const getAuctionData = item => {
    return {
        deadline: Number (item.auctionData.deadline),
        minBid: Number (item.auctionData.minBid),
        highestBid: Number (item.auctionData.highestBid),
        highestBidder: item.auctionData.highestBidder
    }
}

const getRaffleData = item => {
    return {
        deadline: Number (item.raffleData.deadline),
        totalValue: Number (item.raffleData.totalValue),
        totalAddresses: Number (item.raffleData.totalAddresses),
    }
}

const getLoanData = item => {
    return {
        deadline: Number (item.loanData.deadline),
        loanAmount: Number (item.loanData.loanAmount),
        feeAmount: Number (item.loanData.feeAmount),
        numMinutes: Number (item.loanData.numMinutes),
        lender: item.loanData.lender,
    }
}

const fetchMetaAndCollection = async (itemId) => {
    const collectible = await firebase.collection ('collectibles').doc (itemId.toString ()).get ();

    if (!collectible.exists) throw new Error (`Collectible does not exist.`);
    const collectibleData = collectible.data ();
    if (!collectibleData.approved) throw new Error (`Collectible is not approved.`);
    const collectionData = await byId ({ params: { id: collectibleData.collectionId } });

    return {
        meta: collectibleData.meta,
        collection: collectionData.collection.data
    }
}

const fetchCollectionData = async (collectionId) => {
    const collection = await firebase.collection ('collections').doc (collectionId).get ();
    if (!collection.exists) throw new Error (`Collection does not exist.`);

    return { ...collection.data (), id: collectionId };
};

const fetchPosition = async (req, res) => {
    const { provider } = await getWallet ();
    const { positionId } = req.params;
    const marketContract = await marketplaceContract (provider);
    const collectiblesRef = firebase.collection ('collectibles');
    try {
        const item = await marketContract.fetchPosition (positionId);
        const snapshot = await collectiblesRef.where ('approved', '==', true).where ('id', '==', Number (item.item.itemId)).get ();

        if (snapshot.empty) throw new Error (`Collectible does not exist or is not approved.`);

        const collectibleData = snapshot.docs [0].data ();

        const collectionPromise = fetchCollectionData (collectibleData.collectionId);
        const namesPromise = getNamesByEVMAddresses (Array.from (new Set ([item.item.creator, item.owner])));
        
        const [collection, names] = await Promise.all ([collectionPromise, namesPromise]);

        let namesObj = {};
        names.forEach (name => {
            namesObj = { ...namesObj, [name.address]: name.name };
        });

        const itemObject = {
            positionId: Number (item.positionId),
            itemId: Number (item.item.itemId),
            tokenId: Number (item.item.tokenId),
            collection: collection,
            creator: {
                address: item.item.creator,
                avatar: `https://avatars.dicebear.com/api/identicon/${item.item.creator}.svg`,
                name: namesObj [item.item.creator] || item.item.creator
            },
            owner: {
                address: item.owner,
                avatar: `https://avatars.dicebear.com/api/identicon/${item.owner}.svg`,
                name: namesObj [item.owner] || item.owner
            },
            amount: Number (item.amount),
            sale: item.state === 1 ? getSaleData (item) : null,
            auction: item.state === 2 ? getAuctionData (item) : null,
            raffle: item.state === 3 ? getRaffleData (item) : null,
            loan: item.state === 4 ? getLoanData (item) : null,
            marketFee: Number (item.marketFee),
            state: item.state,
            meta: collectibleData.meta
        }
        res.status (200).json (itemObject);
    } catch (err) {
        console.log (err);
        res.json ({
            error: err
        });
    }
}

const sliceIntoChunks = (arr, chunkSize) => {
    const res = [];
    for (let i = 0; i < arr.length; i += chunkSize) {
        const chunk = arr.slice (i, i + chunkSize);
        res.push (chunk);
    }
    return res;
}

const getDbCollectibles = async (items) => {
    const collectiblesRef = firebase.collection ('collectibles');
    const chunks = sliceIntoChunks (items, 10);
    const promiseArray = chunks.map (chunk => collectiblesRef.where ('id', 'in', chunk).get ());
    const collectibles = await Promise.allSettled (promiseArray);
    return collectibles
        .filter (chunk => chunk.status === 'fulfilled')
        .map (chunk => chunk.value.docs)
        .reduce ((acc, curr) => [...acc, ...curr], [])
        .map (doc => doc.data ());
}

const getDbApprovedIds = async () => {
    const ids = await firebase.collection ('blacklists').doc ('collectibles').get ();
    return ids.data ().allowed;
}
// TODO: fetch collections in chunks
const getDbCollections = async (items) => {
    const collectionsRef = firebase.collection ('collections');
    const chunks = sliceIntoChunks (items, 10);
    const promiseArray = chunks.map (chunk => collectionsRef.where (FieldPath.documentId (), 'in', chunk).get ());
    const collections = await Promise.allSettled (promiseArray);
    return collections
        .filter (chunk => chunk.status === 'fulfilled')
        .map (chunk => chunk.value.docs)
        .reduce ((acc, curr) => [...acc, ...curr], [])
        .map (doc => { return { id: doc.id, data: doc.data () }});
}

const getNamesByEVMAddresses = async (addresses) => {
    const usersRef = firebase.collection ('users');
    const chunks = sliceIntoChunks (addresses, 10);
    const promiseArray = chunks.map (chunk => usersRef.where ('evmAddress', 'in', chunk).get ());
    const users = await Promise.allSettled (promiseArray);
    return users
        .filter (chunk => chunk.status === 'fulfilled')
        .map (chunk => chunk.value.docs)
        .reduce ((acc, curr) => [...acc, ...curr], [])
        .map (doc => { return { name: doc.data ().displayName, address: doc.data ().evmAddress }});
}

const fetchPositions = async (req, res) => {
    const { provider } = await getWallet ();
    const { type, ownerAddress, collectionId } = req.params;
    const page = Number (req.query.page) || 1;
    const perPage = Math.min (Number (req.query.perPage), 100) || 10;
    const marketContract = await marketplaceContract (provider);
    try {
        const validIdsPromise = getDbApprovedIds ()
        const allRawItemsPromise = type ? marketContract.fetchPositionsByState (Number (type)) : marketContract.fetchAddressPositions (ownerAddress);
        const [allowedIds, allRawItems] = await Promise.all ([validIdsPromise, allRawItemsPromise]);

        const validItems = allowedIds.reduce ((acc, curr) => {
            acc [curr.id] = curr;
            return acc;
        }, {});

        // filter by verified, owner, and collection
        let rawItems = allRawItems.filter (item => (
            item.item.itemId.toString () in validItems &&
            (ownerAddress ? (item.owner === ownerAddress) : true) &&
            (collectionId ? (validItems [item.item.itemId].collection === collectionId) : true)
            )
        );
        // pagination
        rawItems = rawItems.reverse ().slice ((page - 1) * perPage, page * perPage);

        // get unique item IDs from rawItems
        const itemIds = Array.from (new Set (rawItems.map (item => Number (item.item.itemId))));
        const collectionsSet = new Set (rawItems.map (item => validItems [item.item.itemId.toString ()].collection));
        const addresses = new Set (rawItems.reduce ((acc, item) => [...acc, item.owner, item.item.creator], []));
        // get collectibles, names, and collections from db
        const collectiblesPromise = getDbCollectibles (itemIds);
        // const namesPromise = Promise.allSettled (Array.from (addresses).map (async address => {
        //     return { name: await getNameByEVMAddress (address), address };
        // }));
        const namesPromise = getNamesByEVMAddresses (Array.from (addresses));
        const collectionsPromise = getDbCollections (Array.from (collectionsSet));
        const [collectibles, names, collections] = await Promise.all ([collectiblesPromise, namesPromise, collectionsPromise]);

        const collectiblesObject = collectibles.reduce ((acc, curr) => {
            acc [curr.id] = curr;
            return acc;
        }, {});

        const collectionsObject = collections.reduce ((acc, collection) => {
            return { ...acc, [collection.id]: collection.data };
        }, {});
        let namesObj;
        names.forEach (name => {
            namesObj = { ...namesObj, [name.address]: name.name };
        });
        const items = [];
        for (let i = 0; i < rawItems.length; i++) {
            const item = rawItems [i];
            items.push ({
                positionId: Number (item.positionId),
                itemId: Number (item.item.itemId),
                tokenId: Number (item.item.tokenId),
                collection: collectionsObject [validItems [item.item.itemId.toString ()].collection],
                creator: {
                    address: item.item.creator,
                    avatar: `https://avatars.dicebear.com/api/identicon/${item.item.creator}.svg`,
                    name: namesObj [item.item.creator] || item.item.creator
                },
                owner: {
                    address: item.owner,
                    avatar: `https://avatars.dicebear.com/api/identicon/${item.owner}.svg`,
                    name: namesObj [item.owner] || item.owner
                },
                amount: Number (item.amount),
                sale: item.state === 1 ? getSaleData (item) : null,
                auction: item.state === 2 ? getAuctionData (item) : null,
                raffle: item.state === 3 ? getRaffleData (item) : null,
                loan: item.state === 4 ? getLoanData (item) : null,
                marketFee: Number (item.marketFee),
                state: item.state,
                meta: collectiblesObject [item.item.itemId.toString ()].meta,
            });
        }
        res.status (200).json ({
            items,
            pagination: {
                page,
                perPage,
            }
        });
    } catch (err) {
        console.log (err);
        res.json ({
            error: err
        });
    }
};

module.exports = {
    router: () => {
        const router = Router ();
        router.get ('/all/:type', fetchPositions);
        router.get ('/by-owner/:ownerAddress', fetchPositions);
        router.get ('/by-owner/:ownerAddress/:type', fetchPositions);
        router.get ('/by-collection/:collectionId/:type', fetchPositions);
        router.get ('/position/:positionId', fetchPosition);
        return router;
    }
}