require('dotenv').config({ path: './../env/freeton.env' });

const logger = require('mocha-logger');
const assert = require('assert');
const freeton = require('freeton-truffle');
const utils = require('freeton-truffle/utils');

let Bridge;
let EthereumEventConfiguration;
let EthereumEvent;
let Target;
let EventProxy;


const tonWrapper = new freeton.TonWrapper({
  network: process.env.NETWORK,
  seed: process.env.SEED,
  randomTruffleNonce: Boolean(process.env.RANDOM_TRUFFLE_NONCE),
});


const ethereumEventABI = '{"anonymous":false,"inputs":[{"indexed":false,"internalType":"uint256","name":"state","type":"uint256"},{"indexed":false,"internalType":"address","name":"author","type":"address"}],"name":"StateChange","type":"event"}';
const ethereumEventAddress = '0x4169D71D56563eA9FDE76D92185bEB7aa1Da6fB8';



describe('Test ETH-TON event transfer', function() {
  this.timeout(12000000);

  before(async function() {
    await tonWrapper.setup();

    Bridge = await freeton.requireContract(tonWrapper, 'Bridge');
    await Bridge.loadMigration();
    
    EventProxy = await freeton.requireContract(tonWrapper, 'EventProxy');
    await EventProxy.loadMigration();

    logger.log(`Bridge address: ${Bridge.address}`);
    logger.log(`EventProxy address: ${EventProxy.address}`);
  });
  
  describe('Confirm ETH-TON event transfer', async function() {
    let ethereumEventParams;

    it('Add Ethereum event configuration', async () => {
      const ethereumEventABIAsBytes = utils.stringToBytesArray(ethereumEventABI);
      const ethereumAddressAsBytes = utils.stringToBytesArray(ethereumEventAddress);
      
      // Add Event
      await Bridge.run(
        'addEthereumEventConfiguration',
        {
          ethereumEventABI: ethereumEventABIAsBytes,
          ethereumAddress: ethereumAddressAsBytes,
          eventProxyAddress: EventProxy.address,
          ethereumEventBlocksToConfirm: 1,
          ethereumEventRequiredConfirmations: 2,
          ethereumEventRequiredRejects: 2,
          ethereumEventInitialBalance: utils.convertCrystal(10, 'nano'),
        }
      ).catch(e => console.log(e));
      
      // Derive EthereumEventConfiguration address from the event
      const events = await Bridge.getEvents('NewEthereumEventConfiguration');
      
      const {
        output: {
          addr: ethereumEventConfigurationAddress,
        }
      } = events.pop();

      logger.success(`Ethereum event configuration address: ${ethereumEventConfigurationAddress}`);
  
      EthereumEventConfiguration = await freeton.requireContract(
        tonWrapper,
        'EthereumEventConfiguration',
        ethereumEventConfigurationAddress
      );
      
      // Check the deployed data
      const ethereumEventConfigurationDetails = await EthereumEventConfiguration.runLocal('getDetails', {});
      
      assert.equal(
        ethereumEventConfigurationDetails._proxyAddress,
        EventProxy.address,
        'Wrong proxy address',
      );

      assert.equal(
        ethereumEventConfigurationDetails._eventABI.toString('utf8'),
        ethereumEventABI,
        'Wrong Ethereum Event ABI',
      );

      assert.equal(
        ethereumEventConfigurationDetails._eventAddress.toString('utf8'),
        ethereumEventAddress,
        'Wrong Ethereum Event address',
      );

      assert.equal(
        ethereumEventConfigurationDetails._confirmKeys.length,
        1,
        'Wrong amount of confirmations',
      );

      assert.equal(
        ethereumEventConfigurationDetails._ethereumEventBlocksToConfirm,
        1,
        'Wrong blocks to confirm',
      );

      assert.equal(
        ethereumEventConfigurationDetails._active,
        false,
        'Wrong active status',
      );
    });

    it('Confirm Ethereum event configuration', async () => {
      // Confirm with another relay key
      await Bridge.run(
        'confirmEthereumEventConfiguration',
        {
          ethereumEventConfigurationAddress: EthereumEventConfiguration.address
        },
        tonWrapper.keys[1]
      ).catch(e => console.log(e));

      // Check the deployed data
      const ethereumEventConfigurationDetails = await EthereumEventConfiguration
        .runLocal('getDetails', {});

      assert.equal(
        ethereumEventConfigurationDetails._confirmKeys.length,
        2,
        'Wrong amount of confirmations',
      );

      assert.equal(
        ethereumEventConfigurationDetails._active,
        true,
        'Wrong active status',
      );
    });

    it('Emit Ethereum event', async () => {
      ethereumEventParams = {
        eventTransaction: 1,
        eventIndex: 1,
        eventData: '',
        eventBlockNumber: 1,
        eventBlock: 1,
        ethereumEventConfigurationAddress: EthereumEventConfiguration.address
      };

      await Bridge.run('confirmEthereumEvent', ethereumEventParams).catch(e => console.log(e));

      const {
        output: {
          addr: ethereumEventAddress,
        }
      } = (await EthereumEventConfiguration.getEvents('NewEthereumEventConfirmation')).pop();

      logger.success(`Ethereum event address: ${ethereumEventAddress}`);

      EthereumEvent = await freeton.requireContract(
        tonWrapper,
        'EthereumEvent',
        ethereumEventAddress
      );

      const details = await EthereumEvent.runLocal('getDetails', {});

      assert.equal(
        details._proxyCallbackExecuted,
        false,
        'Wrong callback executed status'
      );

      assert.equal(
        details._eventBlockNumber,
        1,
        'Wrong block number'
      );

      assert.equal(
        1,
        1,
        'Wrong block hash',
      );
    });

    it('Confirm ETH-TON event transfer', async () => {
      await Bridge.run('confirmEthereumEvent', ethereumEventParams, tonWrapper.keys[1]);

      const eventDetails = await EthereumEvent.runLocal('getDetails', {});

      assert.equal(
        eventDetails._proxyCallbackExecuted,
        true,
        'Wrong callback executed status'
      );

      // Check that Proxy received the callback call
      const proxyDetails = await EventProxy.runLocal('getDetails');
      
      assert.equal(
        proxyDetails._callbackReceived,
        true,
        'Wrong proxy callback status',
      );
    });
  });
  
  describe('Test Ethereum event rejection', async function() {
    let ethereumEventParams;

    it('Add new event', async function() {
      ethereumEventParams = {
        eventTransaction: 2,
        eventIndex: 2,
        eventData: '',
        eventBlockNumber: 2,
        eventBlock: 2,
        ethereumEventConfigurationAddress: EthereumEventConfiguration.address
      };

      await Bridge.run('confirmEthereumEvent', ethereumEventParams);

      const {
        output: {
          addr: ethereumEventAddress,
        }
      } = (await EthereumEventConfiguration.getEvents('NewEthereumEventConfirmation')).pop();

      logger.success(`Ethereum event address: ${ethereumEventAddress}`);

      EthereumEvent = await freeton.requireContract(
        tonWrapper,
        'EthereumEvent',
        ethereumEventAddress
      );

      const details = await EthereumEvent.runLocal('getDetails', {});

      assert.equal(
        details._confirmKeys.length,
        1,
        'Wrong amount of confirm keys',
      );

      assert.equal(
        details._rejectKeys.length,
        0,
        'Wrong amount of reject keys',
      );

      assert.equal(
        details._eventRejected,
        false,
        'Wrong event rejected status',
      );

      assert.equal(
        details._proxyCallbackExecuted,
        false,
        'Wrong proxy callback status',
      );
    });

    it('Reject event', async function() {
      await Bridge.run('rejectEthereumEvent', ethereumEventParams, tonWrapper.keys[1]);
      await Bridge.run('rejectEthereumEvent', ethereumEventParams, tonWrapper.keys[2]);

      const details = await EthereumEvent.runLocal('getDetails', {});

      assert.equal(
        details._eventRejected,
        true,
        'Wrong event rejected status'
      );

      assert.equal(
        details._rejectKeys.length,
        2,
        'Wrong amount of reject keys'
      );
    });
  });
});