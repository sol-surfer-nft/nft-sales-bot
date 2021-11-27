//Import libraries
const solanaWeb3 = require('@solana/web3.js'); //Interact with the nodes on the solana chain
const { Connection, programs} = require('@metaplex/js'); //Tools. contract, standards to interact with Solana NFTS
const axios = require('axios') //Handling HTTP requests

/***Validation****/

// Validating project address and Discord URL  - experiencing bad request, receiving status 400 when using the MetaTeds Webhooks URL 
if(!process.env.PROJECT_ADDRESS || !process.env.DISCORD_URL) {
    console.log("Please set your environment variables")
    //return
    
}

// Connection to Metaplex and Solana mainnet

const projectPubKey = new solanaWeb3.PublicKey(process.env.PROJECT_ADDRESS);
const url = solanaWeb3.clusterApiUrl('mainnet-beta');
const solana_connection = new solanaWeb3.Connection(url, 'confirmed');
const metaplex_connection = new Connection('mainnet-beta');
const { metadata: {Metadata} } = programs;
const pollingInterval = 3000; // 3 seconds

// Marketplace metadata (Program Address)
const mpMap = {
    "MEisE1HzehtrDpAAT8PnLHjpSSkRYakotTuJRPjTpo8": "Magic Eden",
    "HZaWndaNWHFDd9Dhk5pqUUtsmoBCqzb1MLu3NAh1VX6B": "Alpha Art",
    "CJsLwbP1iu5DuUikHEJnLfANgKy6stB2uFgvBBHoyxwz": "Solanart",
    "617jbWo616ggkDxvW1Le8pV38XLbVSyWY8ae6QUmGBAU": "Solsea",
    "A7p8451ktDCHq5yYaHczeLMYsjRsAkzc3hCXcSrwYHU7": "Digital Eyes",
    "AmK5g2XcyptVLCFESBCJqoSfwV3znGoVYQnqEnaAZKWn": "Exchange Art",
    //"": "SolSurfer"
}

const imgMap = {

}
//Main function
const runSalesBot = async () => {
    console.log("starting sales bot...");

    let signatures;
    let lastKnownSignature;
    const options = {};

    //fetch transaction signatures in an infinite loop
    while(true) {
        try {
            /*Confirmed signatures for transactions involving the given address, 
            backwards in time from the most recent confirmed block  */
            signatures = await solana_connection.getSignaturesForAddress(projectPubKey, options); //signatures are passed in the options arg
            
            //Check to see if there are transactions to process
            if(!signatures.length) {
                console.log("Polling...");
                await timer(pollingInterval);
                continue;
            }
        } catch(err) {
            console.log("error returning signatures: ", err);
            continue;
        }
        //Transactions are in order of descending time so we muust retrieve the last element
        for (let i = signatures.length-1; i>=0; i--){
            try{
                let { signature } = signatures[i];
                const transc = await solana_connection.getTransaction(signature);
                if (transc.meta && transc.meta.err != null) {continue;}

                const dateString = new Date(transc.blockTime * 1000).toLocaleString();
                const price = Math.abs((transc.meta.preBalances[0] - transc.meta.postBalances[0])) / solanaWeb3.LAMPORTS_PER_SOL;
                //retrieve all accounts used in the transaction
                const accounts = transc.transaction.message.accountKeys;
                //retrieve the account address of the marketplace - usually the last account on the list and convert it to a string
                const marketplaceAccount = accounts[accounts.length-1].toString();


                //Retrieve NFT sale metadata from marketplace
                if (mpMap[marketplaceAccount]){ //treu - if the account address matches the address in the mpMap object, false- if not
                    const metadata = await getMetadata(transc.meta.postTokenBalances[0].mint);
                    if (!metadata) {console.log("Couldn't get metadata"); continue;}
                    
                    
                    printSalesInfo(dateString, price, signature, metadata.name, mpMap[marketplaceAccount], metadata.image);
                    await postSaleToDiscord(metadata.name, price, dateString, signature, metadata.image, mpMap[marketplaceAccount]);
                } else{ 
                    console.log('not a supported a marketplace sale');
                }
            } catch (err){
                console.log("error looping through transactions: ", err);
                continue;
            }
        }
        //Fetch the transaction that occured since the last time that we requested or polled
        lastKnownSignature = signatures[0].signature;
        if(lastKnownSignature){
            options.until = lastKnownSignature;
        }
    }

    
}

//Return function - run the bot
runSalesBot();

//Print the sales info to the console
const printSalesInfo = (date, price, signature, title, marketplace, imageURL) => {
    console.log("***************************************");
    console.log(`Sale at ${date} ---> ${price} SOL`);
    console.log("Signature: ", signature);
    console.log("Name: ", title);
    console.log("Image: ", imageURL);
    console.log("Marketplace: ", marketplace);
}

//Create a new promise for the timer
const timer = ms => new Promise(res => setTimeout(res, ms));


//Make successive network calls to get the metadata - this is slow in practice since the last call is usually made to the IPFS
const getMetadata = async (tokenPubKey) => {
    try {
        //get the program derived address (PDA) for our token's address
        const addr = await Metadata.getPDA(tokenPubKey);
        //Metaplex built in function to link to the metadata
        const resp = await Metadata.load(metaplex_connection, addr);
        const { data } = await axios.get(resp.data.data.uri);

        return data;
    } catch(err) {
        console.log("Error while fetching the metadata: ", err);
    }
}

const postSaleToDiscord = (title, price, date, signature, imageURL, marketplace) => {
    axios.post(process.env.DISCORD_URL,
        {
            "username": "Ted Scraper",
            //"avatar_url":""
            "embeds": [
                {
                    "author": {
                        "name": "Ted Market Bot",
                        "icon_url": "https://pbs.twimg.com/media/FECKzDfXIAY6xn7?format=png&name=900x900"
                    },
                    "fields": [
                        {
                            "name": "Name",
                            "value":`${title}`,
                            "inline": true

                        },
                        {
                            "name": "Amount",
                            "value": `${price} SOL`,
                            "inline": true
                        },
                        {
                            "name": "Date",
                            "value": `${date}`,
                        },
                        {
                            "name": "Explorer",
                            "value": `https://explorer.solana.com/tx/${signature}`
                        }
                    ],
                    "image": {
                        "url": `${imageURL}`,
                    },
                    "footer": {
                        "text": `${marketplace}`
                    }
                }
            ]
        }
    )
}

/*Optimized version to get the metadata from the marketplace using Magic Eden Api call for the mint address. 
- Metadata is cached this way, but exposes an unofficial public endpoint that is subject to change
const getMetadata = async (mintAddress) => {
    try {
        const { data } = await axios.get(`https://api.mainnet.magiceden.io/;rpc/getNFTByMintAddress/${mintAddress}`);
        return data;
    } catch (err) {
        console.log("error fetching metadata: ", err);
    }
}*/

