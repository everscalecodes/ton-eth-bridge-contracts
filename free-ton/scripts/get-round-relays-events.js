const {
  isValidTonAddress,
} = require('./../test/utils');

const ethers = require('ethers');
const BigNumber = require('bignumber.js');
const fs = require('fs');


const requireEnv = (name, _default) => {
  const value = process.env[name];

  if (value === undefined && _default === undefined) {
    throw new Error(`Missing env at ${name}`);
  }

  return value || _default;
};


const getEvents = async (configuration, ge_created_at=0) => {
  const {
    result
  } = (await locklift.ton.client.net.query_collection({
        collection: 'messages',
        filter: {
          src: {
            eq: configuration.address
          },
          msg_type: {
            eq: 2
          },
          created_at: {
            gt: ge_created_at
          }
        },
        result: 'body id src created_at',
      }
  ));

  const events = (await configuration.decodeMessages(result, true, 'output'))
      .filter(m => m.name === 'NewEventContract');

  if (events.length === 0) return [];

  return [
    ...events,
    ...(await getEvents(configuration, events[events.length - 1].created_at))
  ];
};



const main = async () => {
  const rpc = requireEnv('EVM_RPC');
  const bridgeAddress = requireEnv('EVM_BRIDGE');
  const configuration = requireEnv('ROUND_RELAYS_CONFIGURATION');
  const seed = requireEnv('EVM_SEED');
  const cellEncoder = requireEnv('CELL_ENCODER');
  const targetGasPrice = ethers.utils.parseUnits(requireEnv('TARGET_GAS_PRICE'), 9);

  // Connect to the Ethereum
  const provider = new ethers.providers.JsonRpcProvider(rpc);
  const bridge = new ethers.Contract(
    bridgeAddress,
    JSON.parse(fs.readFileSync('./../ethereum/abi/Bridge.json')),
    provider
  );
  const submitter = ethers.Wallet.fromMnemonic(seed).connect(provider);

  const lastRound = await bridge.lastRound();

  console.log(`Last round in Ethereum bridge: ${lastRound}`);

  // Get events from the configuration
  const roundRelaysConfiguration = await locklift.factory.getContract('TonEventConfiguration');
  roundRelaysConfiguration.address = configuration;

  const cellEncoderStandalone = await locklift.factory.getContract('CellEncoderStandalone');
  cellEncoderStandalone.setAddress(cellEncoder);

  // const events = await roundRelaysConfiguration.getEvents('NewEventContract');
  const events = await getEvents(roundRelaysConfiguration);

  const roundRelaysConfigurationDetails = await roundRelaysConfiguration.call({ method: 'getDetails' });

  console.log(`Found ${events.length} events`);

  // Get event details
  const eventDetails = await Promise.all(events.map(async (event) => {
    const stakingTonEvent = await locklift.factory.getContract('StakingTonEvent');
    stakingTonEvent.address = event.value.eventContract;

    const details = await stakingTonEvent.call({method: 'getDetails'});

    // console.log(stakingTonEvent.address);
    // console.log(details);

    const eventData = await cellEncoderStandalone.call({
      method: 'decodeTonStakingEventData',
      params: {data: details._eventInitData.voteData.eventData}
    });
    const eventDataEncoded = ethers.utils.defaultAbiCoder.encode(
      ['uint32', 'uint160[]', 'uint32'],
      [eventData.round_num.toString(), eventData.eth_keys, eventData.round_end.toString()]
    );
    const roundNumber = await stakingTonEvent.call({ method: 'round_number' });

    const encodedEvent = ethers.utils.defaultAbiCoder.encode(
      [
        `tuple(
          uint64 eventTransactionLt,
          uint32 eventTimestamp,
          bytes eventData,
          int8 configurationWid,
          uint256 configurationAddress,
          int8 eventContractWid,
          uint256 eventContractAddress,
          address proxy,
          uint32 round
        )`
      ],
      [{
        eventTransactionLt: details._eventInitData.voteData.eventTransactionLt.toString(),
        eventTimestamp: details._eventInitData.voteData.eventTimestamp.toString(),
        eventData: eventDataEncoded,
        configurationWid: roundRelaysConfiguration.address.split(':')[0],
        configurationAddress: '0x' + roundRelaysConfiguration.address.split(':')[1],
        eventContractWid: event.value.eventContract.split(':')[0],
        eventContractAddress: '0x' + event.value.eventContract.split(':')[1],
        proxy: `0x${roundRelaysConfigurationDetails._networkConfiguration.proxy.toString(16)}`,
        round: roundNumber.toString(),
      }]
    );
    let signatures = await Promise.all(details._signatures.map(async (sign) => {
      return {sign, address: ethers.BigNumber.from(await bridge.recoverSignature(encodedEvent, sign))};
    }));
    signatures.sort((a, b) => {
      if (a.address.eq(b.address)) {
        return 0
      }
      if (a.address.gt(b.address)) {
        return 1
      } else {
        return -1
      }
    })
    return {
      ...details,
      roundNumber,
      encodedEvent,
      eventData,
      eventContract: event.value.eventContract,
      signatures: signatures.map((d) => d.sign),
      created_at: event.created_at
    };

  }));

  for (let event of eventDetails.sort((a,b) => (a.roundNumber < b.roundNumber) ? -1 : 1)) {
    console.log(`Round Number: ${event.eventData.round_num}`);
    console.log(`Event contract: ${event.eventContract}`);
    console.log(`Payload: ${event.encodedEvent}`);
    console.log(`Signatures: \n[${event.signatures.map((b) => '0x' + b.toString('hex')).join(',')}]`);

    if (event.roundNumber >= lastRound) {
      console.log(`Submitting round`);

      console.log(`Submitter: ${submitter.address}`);
      console.log(`Balance: ${ethers.utils.formatUnits(await provider.getBalance(submitter.address), 18)}`);


      const gasPrice = await provider.getGasPrice();
      console.log(`Gas price: ${ethers.utils.formatUnits(gasPrice, "gwei")}`);
      console.log(`Target gas price: ${ethers.utils.formatUnits(targetGasPrice, "gwei")}`);

      // Check submitter dont have any pending transactions
      const pendingCount = await provider.getTransactionCount(submitter.address, 'pending');
      const confirmedCount = await provider.getTransactionCount(submitter.address, 'latest');

      console.log(`Submitter transactions count: pending - ${pendingCount}, confirmed - ${confirmedCount}`);

      if (pendingCount > confirmedCount) {
        console.log(`Submitter has pending transactions, exit`);
        process.exit(1);
      }

      const tx = await bridge.connect(submitter).setRoundRelays(
        event.encodedEvent,
        event.signatures,
        {
          gasPrice: targetGasPrice.gt(gasPrice) ? gasPrice : targetGasPrice // Use min gas price possible
        }
      );

      console.log(`Transaction: ${tx.hash}`);

      process.exit(0);
    }

    console.log('');
  }
};


main()
  .then(() => process.exit(0))
  .catch(e => {
    console.log(e);
    process.exit(1);
  });
