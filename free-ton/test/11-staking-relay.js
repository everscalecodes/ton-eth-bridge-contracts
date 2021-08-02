const {
    expect,
} = require('./utils');
const BigNumber = require('bignumber.js');
const logger = require('mocha-logger');
const {
    convertCrystal
} = locklift.utils;

const EMPTY_TVM_CELL = 'te6ccgEBAQEAAgAAAA==';

const TOKEN_PATH = '../node_modules/ton-eth-bridge-token-contracts/free-ton/build';

const stringToBytesArray = (dataString) => {
    return Buffer.from(dataString).toString('hex')
};

const getRandomNonce = () => Math.random() * 64000 | 0;

const afterRun = async () => {
    await new Promise(resolve => setTimeout(resolve, 500));
};

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));


const bridge = '0:9cc3d8668d57d387eae54c4398a1a0b478b6a8c3a0f2b5265e641a212b435231'
const user1_eth_addr = '0x93E05804b0A58668531F65A93AbfA1aD8F7F5B2b';
const user2_eth_addr = '0x197216E3421D13A72Fdd79A44d8d89f121dcab6C';
const user3_eth_addr = '0xaF2AAf6316a137bbD7D4a9d3279D06E80EE79423';

let stakingRoot;
let stakingToken;
let stakingWallet;

let user1;
let user1Data;
let user2;
let user2Data;
let user3;
let user3Data;
let stakingOwner;
let userTokenWallet1;
let userTokenWallet2;
let userTokenWallet3;
let ownerWallet;
let userInitialTokenBal = 100000;
let rewardTokensBal = 10000;
let userDeposit = 100;
let rewardPerSec = 1000;
let user1Balance;
let user2Balance;
let user3Balance;
let balance_err;

const RELAY_ROUND_TIME_1 = 10;
const RELAYS_COUNT_1 = 4;


describe('Test Staking Rewards', async function () {
    this.timeout(10000000);

    const deployTokenRoot = async function (token_name, token_symbol) {
        const RootToken = await locklift.factory.getContract('RootTokenContract', TOKEN_PATH);
        const TokenWallet = await locklift.factory.getContract('TONTokenWallet', TOKEN_PATH);
        const [keyPair] = await locklift.keys.getKeyPairs();

        const _root = await locklift.giver.deployContract({
            contract: RootToken,
            constructorParams: {
                root_public_key_: `0x${keyPair.public}`,
                root_owner_address_: locklift.ton.zero_address
            },
            initParams: {
                name: stringToBytesArray(token_name),
                symbol: stringToBytesArray(token_symbol),
                decimals: 9,
                wallet_code: TokenWallet.code,
                _randomNonce: getRandomNonce(),
            },
            keyPair,
        }, locklift.utils.convertCrystal(15, 'nano'));
        _root.afterRun = afterRun;
        _root.setKeyPair(keyPair);

        return _root;
    }

    const deployTokenWallets = async function(users) {
        return await Promise.all(users.map(async (user) => {
            await user.runTarget({
                contract: stakingToken,
                method: 'deployEmptyWallet',
                params: {
                    deploy_grams: convertCrystal(1, 'nano'),
                    wallet_public_key_: 0,
                    owner_address_: user.address,
                    gas_back_address: user.address
                },
                value: convertCrystal(2, 'nano'),
            });

            const userTokenWalletAddress = await stakingToken.call({
                method: 'getWalletAddress',
                params: {
                    wallet_public_key_: 0,
                    owner_address_: user.address
                },
            });

            let userTokenWallet = await locklift.factory.getContract('TONTokenWallet', TOKEN_PATH);
            userTokenWallet.setAddress(userTokenWalletAddress);
            return userTokenWallet;
        }));
    };

    const deployAccount = async function (key, value) {
        const Account = await locklift.factory.getAccount('Wallet');
        let account = await locklift.giver.deployContract({
            contract: Account,
            constructorParams: {},
            initParams: {
                _randomNonce: Math.random() * 6400 | 0,
            },
            keyPair: key
        }, locklift.utils.convertCrystal(value, 'nano'));
        account.setKeyPair(key);
        account.afterRun = afterRun;
        return account;
    }

    const getUserTokenWallet = async function (user) {
        const expectedWalletAddr = await stakingToken.call({
            method: 'getWalletAddress',
            params: {
                wallet_public_key_: 0,
                owner_address_: user.address
            }
        });
        const userTokenWallet = await locklift.factory.getContract('TONTokenWallet', TOKEN_PATH);
        userTokenWallet.setAddress(expectedWalletAddr);
        return userTokenWallet;
    }

    const checkTokenBalances = async function(userTokenWallet, userAccount, pool_wallet_bal, pool_bal, pool_reward_bal, user_bal, user_data_bal) {
        const _pool_wallet_bal = await stakingWallet.call({method: 'balance'});
        const _pool_bal = await stakingRoot.call({method: 'tokenBalance'});
        const _pool_reward_bal = await stakingRoot.call({method: 'rewardTokenBalance'});
        const _user_bal = await userTokenWallet.call({method: 'balance'});
        const _user_data_bal = await userAccount.call({method: 'token_balance'});

        // console.log(_pool_wallet_bal.toString(), _pool_bal.toString(), _pool_reward_bal.toString(), _user_bal.toString(), _user_data_bal.toString());

        expect(_pool_wallet_bal.toNumber()).to.be.equal(pool_wallet_bal, 'Pool wallet balance bad');
        expect(_pool_bal.toNumber()).to.be.equal(pool_bal, 'Pool balance bad');
        expect(_pool_reward_bal.toNumber()).to.be.equal(pool_reward_bal, 'Pool reward balance bad');
        expect(_user_bal.toNumber()).to.be.equal(user_bal, 'User balance bad');
        expect(_user_data_bal.toNumber()).to.be.equal(user_data_bal, 'User data balance bad');
    }

    const startNewRewardRound = async function () {
        return await stakingOwner.runTarget({
            contract: stakingRoot,
            method: 'startNewRewardRound',
            params: {
                send_gas_to: stakingOwner.address,
            },
            value: locklift.utils.convertCrystal(5, 'nano')
        });
    }

    const getRewardForRelayRound = async function(user, round_num) {
        return await user.runTarget({
            contract: stakingRoot,
            method: 'getRewardForRelayRound',
            params: {
                round_num: round_num,
                send_gas_to: user.address,
            },
            value: locklift.utils.convertCrystal(1.5, 'nano')
        });
    }

    const claimReward = async function(user) {
        return await user.runTarget({
            contract: stakingRoot,
            method: 'claimReward',
            params: {
                send_gas_to: user.address,
            },
            value: locklift.utils.convertCrystal(1, 'nano')
        });
    }

    const checkReward = async function(userData, prevRewData, prevRewardTime, newRewardTime) {
        const user_rew_after = await userData.call({method: 'rewardRounds'});
        const user_rew_balance_before = prevRewData[0].reward_balance;
        const user_rew_balance_after = user_rew_after[0].reward_balance;

        const reward = user_rew_balance_after - user_rew_balance_before;

        const time_passed = newRewardTime - prevRewardTime;
        const expected_reward = rewardPerSec * time_passed;

        expect(reward).to.be.equal(expected_reward, 'Bad reward');
    }

    const getElection = async function (round_num) {
        const addr = await stakingRoot.call({
            method: 'getElectionAddress',
            params: {round_num: round_num}
        });
        const election = await locklift.factory.getContract('Election');
        election.setAddress(addr);
        return election;
    }

    const getRelayRound = async function (round_num) {
        const addr = await stakingRoot.call({
            method: 'getRelayRoundAddress',
            params: {round_num: round_num}
        });
        const round = await locklift.factory.getContract('RelayRound');
        round.setAddress(addr);
        return round;
    }

    const requestRelayMembership = async function (_user) {
        return await _user.runTarget({
            contract: stakingRoot,
            method: 'becomeRelayNextRound',
            params: {
                send_gas_to: _user.address
            },
            value: convertCrystal(1.5, "nano")
        })
    }

    const endElection = async function () {
        return await stakingOwner.runTarget({
            contract: stakingRoot,
            method: 'endElection',
            params: {
                send_gas_to: stakingOwner.address
            },
            value: convertCrystal(7, "nano")
        })
    }

    const confirmTonRelayAccount = async function (_user, _userData) {
        return await _userData.run({
            method: 'confirmTonAccount',
            params: {},
            keyPair: _user.keyPair
        })
    }

    const confirmEthRelayAccount = async function (_user, _user_eth_addr) {
        return await stakingOwner.runTarget({
            contract: stakingRoot,
            method: 'confirmEthAccount',
            params: {
                staker_addr: _user.address,
                eth_address: _user_eth_addr,
                send_gas_to: stakingOwner.address
            },
            value: convertCrystal(0.7, "nano")
        })
    }

    const linkRelayAccounts = async function (_user, ton_pk, eth_addr) {
        const user_pk = new BigNumber(ton_pk, 16);
        const user_eth = new BigNumber(eth_addr.toLowerCase(), 16);

        const input_params = {
            ton_pubkey: user_pk.toFixed(),
            eth_address: user_eth.toFixed(),
            send_gas_to: stakingOwner.address
        }

        return await _user.runTarget({
            contract: stakingRoot,
            method: 'linkRelayAccounts',
            params: input_params,
            value: convertCrystal(5.1, "nano")
        })
    }

    const getUserDataAccount = async function (_user) {
        const userData = await locklift.factory.getContract('UserData');
        userData.setAddress(await stakingRoot.call({
            method: 'getUserDataAddress',
            params: {user: _user.address}
        }));
        return userData
    }

    const depositTokens = async function (user, _userTokenWallet, depositAmount, reward=false) {
        var payload;
        const DEPOSIT_PAYLOAD = 'te6ccgEBAQEAAwAAAgA=';
        const REWARD_DEPOSIT_PAYLOAD = 'te6ccgEBAQEAAwAAAgE=';
        if (reward) {
            payload = REWARD_DEPOSIT_PAYLOAD;
        } else {
            payload = DEPOSIT_PAYLOAD;
        }

        console.log(user, _userTokenWallet, depositAmount, reward);

        return await user.runTarget({
            contract: _userTokenWallet,
            method: 'transferToRecipient',
            params: {
                recipient_public_key: 0,
                recipient_address: stakingRoot.address,
                tokens: depositAmount,
                deploy_grams: 0,
                transfer_grams: 0,
                send_gas_to: user.address,
                notify_receiver: true,
                payload: payload
            },
            value: locklift.utils.convertCrystal(2.5, 'nano')
        });
    };

    const withdrawTokens = async function(user, withdraw_amount) {
        return await user.runTarget({
            contract: stakingRoot,
            method: 'withdraw',
            params: {
                amount: withdraw_amount,
                send_gas_to: user.address
            },
            value: convertCrystal(1.5, 'nano')
        });
    };

    const showNode = async function(election, idx) {
        const node = await election.call({method: 'getNode', params: {idx: idx}});
        return {
            prev_node: node.prev_node.toString(),
            next_node: node.next_node.toString(),
            staker_addr: node.request.staker_addr,
            staked_tokens: node.request.staked_tokens.toString()
        }
    }

    describe('Setup contracts', async function() {
        describe('Token', async function() {
            it('Deploy root', async function() {
                stakingToken = await deployTokenRoot('Farm token', 'FT');
            });
        });

        describe('Users', async function() {
            it('Deploy users accounts', async function() {
                let users = [];
                let keys = await locklift.keys.getKeyPairs();
                for (const i of [0, 1, 2, 3]) {
                    const keyPair = keys[i];
                    const account = await deployAccount(keyPair, 25);
                    logger.log(`User address: ${account.address}`);

                    const {
                        acc_type_name
                    } = await locklift.ton.getAccountType(account.address);

                    expect(acc_type_name).to.be.equal('Active', 'User account not active');
                    users.push(account);
                }
                [user1, user2, user3, stakingOwner] = users;
            });

            it('Deploy users token wallets', async function() {
                [ userTokenWallet1, userTokenWallet2, userTokenWallet3, ownerWallet ] = await deployTokenWallets([user1, user2, user3, stakingOwner]);
            });

            it('Mint tokens to users', async function() {
                for (const i of [userTokenWallet2, userTokenWallet1, userTokenWallet3, ownerWallet]) {
                    await stakingToken.run({
                        method: 'mint',
                        params: {
                            tokens: userInitialTokenBal,
                            to: i.address
                        }
                    });
                }

                const balance1 = await userTokenWallet1.call({method: 'balance'});
                const balance2 = await userTokenWallet2.call({method: 'balance'});
                const balance3 = await ownerWallet.call({method: 'balance'});
                const balance4 = await userTokenWallet3.call({method: 'balance'});

                expect(balance1.toNumber()).to.be.equal(userInitialTokenBal, 'User ton token wallet empty');
                expect(balance2.toNumber()).to.be.equal(userInitialTokenBal, 'User ton token wallet empty');
                expect(balance3.toNumber()).to.be.equal(userInitialTokenBal, 'User ton token wallet empty');
                expect(balance4.toNumber()).to.be.equal(userInitialTokenBal, 'User ton token wallet empty');

            });
        });

        describe('Staking', async function() {
            it('Deploy staking', async function () {
                const [keyPair] = await locklift.keys.getKeyPairs();

                const StakingRootDeployer = await locklift.factory.getContract('StakingRootDeployer');
                const stakingRootDeployer = await locklift.giver.deployContract({
                    contract: StakingRootDeployer,
                    constructorParams: {},
                    keyPair: keyPair,
                }, locklift.utils.convertCrystal(10, 'nano'));

                logger.log(`Deploying stakingRoot`);
                stakingRoot = await locklift.factory.getContract('Staking');
                stakingRoot.setAddress((await stakingRootDeployer.run({
                    method: 'deploy',
                    params: {
                        stakingCode: stakingRoot.code,
                        _admin: stakingOwner.address,
                        _tokenRoot: stakingToken.address,
                        _dao_root: stakingOwner.address,
                        _rewarder: stakingOwner.address,
                        _bridge: stakingOwner.address
                    }
                })).decoded.output.value0)
                logger.log(`StakingRoot address: ${stakingRoot.address}`);
                logger.log(`StakingRoot owner address: ${stakingOwner.address}`);
                logger.log(`StakingRoot token root address: ${stakingToken.address}`);

                const staking_wallet_addr = await stakingRoot.call({method: 'tokenWallet'});
                logger.log(`Staking token wallet: ${staking_wallet_addr}`);

                stakingWallet = await locklift.factory.getContract('TONTokenWallet', TOKEN_PATH);
                stakingWallet.setAddress(staking_wallet_addr);

                // call in order to check if wallet is deployed
                const details = await stakingWallet.call({method: 'getDetails'});
                expect(details.owner_address).to.be.equal(stakingRoot.address, 'Wrong staking token wallet owner');
                expect(details.receive_callback).to.be.equal(stakingRoot.address, 'Wrong staking token wallet receive callback');
                expect(details.root_address).to.be.equal(stakingToken.address, 'Wrong staking token wallet root');
            });

            it('Installing codes', async function() {
                const UserData = await locklift.factory.getContract('UserData');
                const Election = await locklift.factory.getContract('Election');
                const RelayRound = await locklift.factory.getContract('RelayRound');
                const Platform = await locklift.factory.getContract('Platform');

                logger.log(`Installing Platform code`);
                await stakingOwner.runTarget({
                    contract: stakingRoot,
                    method: 'installPlatformOnce',
                    params: {code: Platform.code, send_gas_to: stakingOwner.address},
                });
                logger.log(`Installing UserData code`);
                await stakingOwner.runTarget({
                    contract: stakingRoot,
                    method: 'installOrUpdateUserDataCode',
                    params: {code: UserData.code, send_gas_to: stakingOwner.address},
                });
                logger.log(`Installing ElectionCode code`);
                await stakingOwner.runTarget({
                    contract: stakingRoot,
                    method: 'installOrUpdateElectionCode',
                    params: {code: Election.code, send_gas_to: stakingOwner.address},
                });
                logger.log(`Installing RelayRoundCode code`);
                await stakingOwner.runTarget({
                    contract: stakingRoot,
                    method: 'installOrUpdateRelayRoundCode',
                    params: {code: RelayRound.code, send_gas_to: stakingOwner.address},
                });
                logger.log(`Set staking to Active`);
                await stakingOwner.runTarget({
                    contract: stakingRoot,
                    method: 'setActive',
                    params: {new_active: true, send_gas_to: stakingOwner.address},
                });

                const active = await stakingRoot.call({method: 'isActive'});
                expect(active).to.be.equal(true, "Staking not active");
            });

            it('Sending reward tokens to staking', async function() {
                const amount = rewardTokensBal;

                await depositTokens(stakingOwner, ownerWallet, amount, true);

                const staking_balance = await stakingWallet.call({method: 'balance'});
                const staking_balance_stored = await stakingRoot.call({method: 'rewardTokenBalance'});

                expect(staking_balance.toString()).to.be.equal(amount.toString(), 'Farm pool balance empty');
                expect(staking_balance_stored.toString()).to.be.equal(amount.toString(), 'Farm pool balance not recognized');
            });

            it("Setting relay config for testing", async function() {
                // super minimal relay config for local testing
                await stakingOwner.runTarget({
                    contract: stakingRoot,
                    method: 'setRelayConfig',
                    params: {
                        relay_round_time: RELAY_ROUND_TIME_1,
                        election_time: 4,
                        time_before_election: 5,
                        relays_count: RELAYS_COUNT_1,
                        min_relays_count: 2,
                        send_gas_to: stakingOwner.address
                    },
                });

                const relays_count = await stakingRoot.call({method: 'relaysCount'});
                expect(relays_count.toString()).to.be.equal(RELAYS_COUNT_1.toString(), "Relay config not installed");
            })
        });
    });

    describe('Relay pipeline testing', async function () {
        describe('Standard case', async function() {
            let user1_deposit_time;
            let user2_deposit_time;
            let user1_withdraw_time;
            let user2_withdraw_time;
            let user3_deposit_time;
            let user3_withdraw_time;

            it('Users deposit tokens', async function () {
                await depositTokens(user1, userTokenWallet1, userDeposit);
                user1Data = await getUserDataAccount(user1);

                await checkTokenBalances(
                    userTokenWallet1, user1Data, rewardTokensBal + userDeposit,
                    userDeposit, rewardTokensBal, userInitialTokenBal - userDeposit, userDeposit
                );
                user1_deposit_time = await stakingRoot.call({method: 'lastRewardTime'});

                await depositTokens(user2, userTokenWallet2, userDeposit * 2);
                user2Data = await getUserDataAccount(user2);

                await checkTokenBalances(
                    userTokenWallet2, user2Data, rewardTokensBal + userDeposit * 3,
                    userDeposit * 3, rewardTokensBal, userInitialTokenBal - userDeposit * 2, userDeposit * 2
                );
                user2_deposit_time = await stakingRoot.call({method: 'lastRewardTime'});

                await depositTokens(user3, userTokenWallet3, userDeposit * 3);
                user3Data = await getUserDataAccount(user3);

                await checkTokenBalances(
                    userTokenWallet3, user3Data, rewardTokensBal + userDeposit * 6,
                    userDeposit * 6, rewardTokensBal, userInitialTokenBal - userDeposit * 3, userDeposit * 3
                );
                user3_deposit_time = await stakingRoot.call({method: 'lastRewardTime'});
            });

            it("Creating origin relay round", async function () {
                const user1_pk = new BigNumber(user1.keyPair.public, 16);
                const user1_eth = new BigNumber(user1_eth_addr.toLowerCase(), 16);

                const input_params = {
                    staker_addrs: [user1.address],
                    ton_pubkeys: [user1_pk.toFixed()],
                    eth_addrs: [user1_eth.toFixed()],
                    staked_tokens: [1],
                    send_gas_to: stakingOwner.address
                }

                const reward_rounds = await stakingRoot.call({method: 'rewardRounds'});

                await stakingOwner.runTarget({
                    contract: stakingRoot,
                    method: 'createOriginRelayRound',
                    params: input_params,
                    value: convertCrystal(2.1, 'nano')
                });

                const round = await getRelayRound(1);
                const total_tokens_staked = await round.call({method: 'total_tokens_staked'});
                const round_reward = await round.call({method: 'round_reward'});
                const relays_count = await round.call({method: 'relays_count'});
                const reward_round_num = await round.call({method: 'reward_round_num'});

                const _round_reward = RELAY_ROUND_TIME_1 * rewardPerSec;
                expect(total_tokens_staked.toString()).to.be.equal('1', "Bad relay round");
                expect(round_reward.toString()).to.be.equal(_round_reward.toString(), "Bad relay round");
                expect(relays_count.toString()).to.be.equal('1', "Bad relay round");
                expect(reward_round_num.toString()).to.be.equal('0', "Bad relay round");

                const cur_relay_round = await stakingRoot.call({method: 'currentRelayRound'});
                expect(cur_relay_round.toString()).to.be.equal('1', "Bad round installed in root");

                const reward_rounds_new = await stakingRoot.call({method: 'rewardRounds'});
                const expected_reward = round_reward.plus(new BigNumber(reward_rounds[0].totalReward));
                expect(expected_reward.toString()).to.be.equal(reward_rounds_new[0].totalReward.toString(), "Bad reward after relay round init");

                const {
                    value: {
                        round_num: _round_num,
                        round_start_time: _round_start_time,
                        round_addr: _round_addr,
                        relays_count: _relays_count,
                        duplicate: _duplicate
                    }
                } = (await stakingRoot.getEvents('RelayRoundInitialized')).pop();

                expect(_round_num.toString()).to.be.equal('1', "Bad event");
                expect(_round_addr).to.be.equal(round.address, "Bad event");

                expect(_relays_count.toString()).to.be.equal('1', "Relay creation fail - relays count");
                expect(_duplicate).to.be.equal(false, "Relay creation fail - duplicate");

                const relay = await round.call({
                    method: 'getRelayByStakerAddress',
                    params: {staker_addr: user1.address}
                });

                expect(relay.staker_addr).to.be.equal(user1.address, "Relay creation fail - staker addr");
                expect(relay.ton_pubkey.toString(16)).to.be.equal(user1_pk.toString(16), "Relay creation fail - ton pubkey");
                expect(relay.eth_addr.toString(16)).to.be.equal(user1_eth.toString(16), "Relay creation fail - eth addr");
                expect(relay.staked_tokens.toString()).to.be.equal('1', "Relay creation fail - staked tokens");

                const origin_initialized = await stakingRoot.call({method: 'originRelayRoundInitialized'});
                expect(origin_initialized).to.be.equal(true, "Origin round not initialized");
            });

            it("Users link relay accounts", async function () {
                await linkRelayAccounts(user1, user1.keyPair.public, user1_eth_addr);

                const user1_pk = await user1Data.call({method: 'relay_ton_pubkey'});
                const _user1_eth_addr = await user1Data.call({method: 'relay_eth_address'});

                const user1_pk_expected = new BigNumber(user1.keyPair.public, 16);
                const user1_eth_addr_expected = new BigNumber(user1_eth_addr.toLowerCase(), 16);

                expect(user1_pk_expected.toString(16)).to.be.equal(user1_pk.toString(16), "Bad ton pubkey installed");
                expect(_user1_eth_addr.toString(16)).to.be.equal(user1_eth_addr_expected.toString(16), "Bad eth addr installed");

                await linkRelayAccounts(user2, user2.keyPair.public, user2_eth_addr);

                const user2_pk = await user2Data.call({method: 'relay_ton_pubkey'});
                const _user2_eth_addr = await user2Data.call({method: 'relay_eth_address'});

                const user2_pk_expected = new BigNumber(user2.keyPair.public, 16);
                const user2_eth_addr_expected = new BigNumber(user2_eth_addr.toLowerCase(), 16);

                expect(user2_pk_expected.toString(16)).to.be.equal(user2_pk.toString(16), "Bad ton pubkey installed");
                expect(_user2_eth_addr.toString(16)).to.be.equal(user2_eth_addr_expected.toString(16), "Bad eth addr installed");

                await linkRelayAccounts(user3, user3.keyPair.public, user3_eth_addr);

                const user3_pk = await user3Data.call({method: 'relay_ton_pubkey'});
                const _user3_eth_addr = await user3Data.call({method: 'relay_eth_address'});

                const user3_pk_expected = new BigNumber(user3.keyPair.public, 16);
                const user3_eth_addr_expected = new BigNumber(user3_eth_addr.toLowerCase(), 16);

                expect(user3_pk_expected.toString(16)).to.be.equal(user3_pk.toString(16), "Bad ton pubkey installed");
                expect(_user3_eth_addr.toString(16)).to.be.equal(user3_eth_addr_expected.toString(16), "Bad eth addr installed");
            });

            it("Users confirm ton relay accounts", async function () {
                await confirmTonRelayAccount(user1, user1Data);
                await confirmTonRelayAccount(user2, user2Data);
                await confirmTonRelayAccount(user3, user3Data);

                const confirmed_user1 = await user1Data.call({method: 'ton_pubkey_confirmed'});
                expect(confirmed_user1).to.be.equal(true, "Ton pubkey user1 not confirmed");

                const confirmed_user2 = await user2Data.call({method: 'ton_pubkey_confirmed'});
                expect(confirmed_user2).to.be.equal(true, "Ton pubkey user2 not confirmed");

                const confirmed_user3 = await user3Data.call({method: 'ton_pubkey_confirmed'});
                expect(confirmed_user3).to.be.equal(true, "Ton pubkey user3 not confirmed");
            })

            it("Users confirm eth relay accounts", async function () {
                await confirmEthRelayAccount(user1, user1_eth_addr);
                await confirmEthRelayAccount(user2, user2_eth_addr);
                await confirmEthRelayAccount(user3, user3_eth_addr);

                const confirmed_user1 = await user1Data.call({method: 'eth_address_confirmed'});
                expect(confirmed_user1).to.be.equal(true, "Eth pubkey user1 not confirmed");

                const confirmed_user2 = await user2Data.call({method: 'eth_address_confirmed'});
                expect(confirmed_user2).to.be.equal(true, "Eth pubkey user2 not confirmed");

                const confirmed_user3 = await user3Data.call({method: 'eth_address_confirmed'});
                expect(confirmed_user3).to.be.equal(true, "Eth pubkey user3 not confirmed");
            })

            it("Election on new round starts", async function () {
                await wait(5000);

                await user1.runTarget({
                    contract: stakingRoot,
                    method: 'startElectionOnNewRound',
                    params: {send_gas_to: user1.address},
                    value: convertCrystal(1.6, 'nano')
                });

                const election = await getElection(2);

                const round_num = await election.call({method: 'round_num'});
                expect(round_num.toString()).to.be.equal('2', "Bad election - round num");

                const {
                    value: {
                        round_num: _round_num,
                        election_start_time: _election_start_time,
                        election_addr: _election_addr,
                    }
                } = (await stakingRoot.getEvents('ElectionStarted')).pop();

                expect(_round_num.toString()).to.be.equal('2', "Bad election - round num");
                expect(_election_addr).to.be.equal(election.address, "Bad election - address");
            })

            it("Users request relay membership", async function () {
                const tx = await requestRelayMembership(user1);
                const election = await getElection(2);

                const {
                    value: {
                        round_num: _round_num1,
                        tokens: _tokens1,
                        ton_pubkey: _ton_pubkey1,
                        eth_address: _eth_address1,
                        lock_until: _lock_until1
                    }
                } = (await user1Data.getEvents('RelayMembershipRequested')).pop();

                const user1_token_balance = await user1Data.call({method: 'token_balance'});

                const user1_pk = new BigNumber(user1.keyPair.public, 16);
                const expected_ton_pubkey1 = `0x${user1_pk.toString(16).padStart(64, '0')}`;
                const user1_eth = new BigNumber(user1_eth_addr.toLowerCase(), 16);
                const block_now = tx.transaction.now + 30 * 24 * 60 * 60;

                const expected_eth_addr = `0x${user1_eth.toString(16).padStart(64, '0')}`
                expect(_round_num1.toString()).to.be.equal('2', 'Bad event - round num');
                expect(_tokens1.toString()).to.be.equal(user1_token_balance.toString(), "Bad event - tokens");
                expect(_ton_pubkey1.toString()).to.be.equal(expected_ton_pubkey1, "Bad event - ton pubkey");
                expect(_eth_address1.toString(16)).to.be.equal(expected_eth_addr, "Bad event - eth address");
                expect(Number(_lock_until1)).to.be.gte(Number(block_now), "Bad event - lock");

                await requestRelayMembership(user3);

                const {
                    value: {
                        round_num: _round_num3,
                        tokens: _tokens3,
                        ton_pubkey: _ton_pubkey3,
                        eth_address: _eth_address3,
                        lock_until: _lock_until3
                    }
                } = (await user3Data.getEvents('RelayMembershipRequested')).pop();

                const user3_token_balance = await user3Data.call({method: 'token_balance'});

                const user3_pk = new BigNumber(user3.keyPair.public, 16);
                const expected_ton_pubkey3 = `0x${user3_pk.toString(16).padStart(64, '0')}`;
                const user3_eth = new BigNumber(user3_eth_addr.toLowerCase(), 16);

                const expected_eth_addr_3 = `0x${user3_eth.toString(16).padStart(64, '0')}`
                expect(_round_num3.toString()).to.be.equal('2', 'Bad event - round num');
                expect(_tokens3.toString()).to.be.equal(user3_token_balance.toString(), "Bad event - tokens");
                expect(_ton_pubkey3.toString()).to.be.equal(expected_ton_pubkey3, "Bad event - ton pubkey");
                expect(_eth_address3.toString(16)).to.be.equal(expected_eth_addr_3, "Bad event - eth address");
                expect(Number(_lock_until3)).to.be.gte(Number(block_now), "Bad event - lock");

                // const [req11, req22] = await election.call({method: 'getRequests', params: {limit: 10}});
                // console.log(req11, req22);
                // console.log(await showNode(election, 1));
                // console.log(await showNode(election, 2));

                await requestRelayMembership(user2);

                const {
                    value: {
                        round_num: _round_num2,
                        tokens: _tokens2,
                        ton_pubkey: _ton_pubkey2,
                        eth_address: _eth_address2,
                        lock_until: _lock_until2
                    }
                } = (await user2Data.getEvents('RelayMembershipRequested')).pop();

                const user2_token_balance = await user2Data.call({method: 'token_balance'});

                const user2_pk = new BigNumber(user2.keyPair.public, 16);
                const expected_ton_pubkey2 = `0x${user2_pk.toString(16).padStart(64, '0')}`;
                const user2_eth = new BigNumber(user2_eth_addr.toLowerCase(), 16);

                const expected_eth_addr_2 = `0x${user2_eth.toString(16).padStart(64, '0')}`
                expect(_round_num2.toString()).to.be.equal('2', 'Bad event - round num');
                expect(_tokens2.toString()).to.be.equal(user2_token_balance.toString(), "Bad event - tokens");
                expect(_ton_pubkey2.toString()).to.be.equal(expected_ton_pubkey2, "Bad event - ton pubkey");
                expect(_eth_address2.toString(16)).to.be.equal(expected_eth_addr_2, "Bad event - eth address");
                expect(Number(_lock_until2)).to.be.gte(Number(block_now), "Bad event - lock");

                // now check requests sorted correctly
                const [req1, req2, req3] = await election.call({method: 'getRequests', params: {limit: 10}});
                // console.log(req1, req2, req3);
                // console.log(await showNode(election, 1));
                // console.log(await showNode(election, 2));
                // console.log(await showNode(election, 3));
                // console.log(user1.address, user2.address, user3.address);

                expect(req1.staker_addr).to.be.equal(user3.address, "Bad request - staker addr");
                expect(req1.staked_tokens.toString()).to.be.equal(user3_token_balance.toString(), "Bad request - token balance");
                expect(req1.ton_pubkey).to.be.equal(expected_ton_pubkey3, "Bad request - ton pubkey");

                expect(req2.staker_addr).to.be.equal(user2.address, "Bad request - staker addr");
                expect(req2.staked_tokens.toString()).to.be.equal(user2_token_balance.toString(), "Bad request - token balance");
                expect(req2.ton_pubkey).to.be.equal(expected_ton_pubkey2, "Bad request - ton pubkey");

                expect(req3.staker_addr).to.be.equal(user1.address, "Bad request - staker addr");
                expect(req3.staked_tokens.toString()).to.be.equal(user1_token_balance.toString(), "Bad request - token balance");
                expect(req3.ton_pubkey).to.be.equal(expected_ton_pubkey1, "Bad request - ton pubkey");
            });

            it("Election ends, new round initialized", async function () {
                await wait(3000);

                const reward_rounds = await stakingRoot.call({method: 'rewardRounds'});

                const tx = await endElection();
                // console.log(tx.transaction.out_msgs);

                const round = await getRelayRound(2);
                // const election = await getElection(2);

                // console.log('root', stakingRoot.address)
                // console.log('election', election.address);
                // console.log('round', round.address);

                const {
                    value: {
                        round_num: _round_num,
                        relay_requests: _relay_requests,
                        min_relays_ok: _min_relays_ok
                    }
                } = (await stakingRoot.getEvents('ElectionEnded')).pop();

                expect(_round_num.toString()).to.be.equal('2', "Bad election event - round num");
                expect(_relay_requests.toString()).to.be.equal('3', "Bad election event - relay requests");
                expect(_min_relays_ok).to.be.equal(true, "Bad election event - min relays");

                const {
                    value: {
                        round_num: _round_num1,
                        round_start_time: _round_start_time,
                        round_addr: _round_addr,
                        relays_count: _relays_count,
                        duplicate: _duplicate
                    }
                } = (await stakingRoot.getEvents('RelayRoundInitialized')).pop();

                expect(_round_num1.toString()).to.be.equal('2', "Bad relay init event - round num");
                expect(_round_addr.toString()).to.be.equal(round.address, "Bad relay init event - round addr");
                expect(_relays_count.toString()).to.be.equal('3', "Bad relay init event - relays count");
                expect(_duplicate).to.be.equal(false, "Bad relay init event - duplicate");

                const stored_round_num = await round.call({method: 'round_num'});
                const stored_relays_count = await round.call({method: 'relays_count'});
                const stored_total_tokens_staked = await round.call({method: 'total_tokens_staked'});
                const stored_reward_round_num = await round.call({method: 'reward_round_num'});
                const stored_relays_installed = await round.call({method: 'relays_installed'});
                const stored_duplicate = await round.call({method: 'duplicate'});

                const expected_staked_tokens = userDeposit * 6;

                expect(stored_round_num.toString()).to.be.equal('2', "Bad round created - round num");
                expect(stored_relays_count.toString()).to.be.equal('3', "Bad round created - relays count");
                expect(stored_total_tokens_staked.toString(16)).to.be.equal(expected_staked_tokens.toString(16), "Bad round created - total tokens staked");
                expect(stored_reward_round_num.toString()).to.be.equal('0', "Bad round created - reward round num");
                expect(stored_relays_installed).to.be.equal(true, "Bad round created - relays installed");
                expect(stored_duplicate).to.be.equal(false, "Bad round created - duplicate");

                const round_reward = await round.call({method: 'round_reward'});
                const reward_rounds_new = await stakingRoot.call({method: 'rewardRounds'});
                // console.log(reward_rounds, reward_rounds_new, round_reward.toString());
                const expected_reward = round_reward.plus(new BigNumber(reward_rounds[0].totalReward));
                expect(expected_reward.toString()).to.be.equal(reward_rounds_new[0].totalReward.toString(), "Bad reward after relay round init");

                const cur_relay_round = await stakingRoot.call({method: 'currentRelayRound'});
                expect(cur_relay_round.toString()).to.be.equal('2', "Bad round installed in root");

                // check all relays are installed
                const relays = await round.call({method: 'getRelayList', params: {count: 10}});
                const rel_addrs = relays.map((elem) => elem.staker_addr);
                expect(rel_addrs.includes(user1.address)).to.be.true;
                expect(rel_addrs.includes(user2.address)).to.be.true;
                expect(rel_addrs.includes(user3.address)).to.be.true;
            });

            it("User1 get reward for origin round", async function() {
                await wait(1000);

                // deposit 1 token to sync rewards
                await depositTokens(user1, userTokenWallet1, 1);
                const user1_rewards = await user1Data.call({method: 'rewardRounds'});

                await getRewardForRelayRound(user1, 1);
                const user1_rewards_1 = await user1Data.call({method: 'rewardRounds'});
                const rewards = await stakingRoot.call({method: 'rewardRounds'});
                const round_reward = rewardPerSec * RELAY_ROUND_TIME_1;

                const _userDeposit = await user1Data.call({method: 'token_balance'});
                const rew_per_share = new BigNumber(rewards[0].accRewardPerShare);
                const new_reward = rew_per_share.times(_userDeposit).div(1e18).minus(user1_rewards[0].reward_debt).dp(0, 1);

                const expected = new_reward.plus(user1_rewards[0].reward_balance).plus(round_reward);
                expect(expected.toString()).to.be.equal(user1_rewards_1[0].reward_balance.toString(), 'Bad reward');

                await getRelayRound(1);

                const {
                    value: {
                        relay_round_num: _relay_round_num,
                        reward_round_num: _reward_round_num,
                        reward: _reward
                    }
                } = (await user1Data.getEvents('RelayRoundRewardClaimed')).pop();

                const expected_reward = rewardPerSec * RELAY_ROUND_TIME_1;
                expect(_relay_round_num.toString()).to.be.equal('1', "Bad relay round reward event - relay round");
                expect(_reward_round_num.toString()).to.be.equal('0', "Bad relay round reward event - reward round");
                expect(_reward.toString()).to.be.equal(expected_reward.toString(), "Bad relay round reward event - reward");
            });
        });

        describe("Not enough relay requests on election", async function() {
            it("New reward round starts", async function () {
                await startNewRewardRound();

                const reward_rounds = await stakingRoot.call({method: 'rewardRounds'});
                const last_reward_time = await stakingRoot.call({method: 'lastRewardTime'});
                const cur_round = reward_rounds[1];

                expect(reward_rounds.length).to.be.equal(2, "Bad reward rounds");
                expect(cur_round.rewardTokens).to.be.equal('0', 'Bad reward rounds balance');
                expect(parseInt(cur_round.accRewardPerShare, 16)).to.be.equal(0, 'Bad reward rounds share');
                expect(cur_round.totalReward).to.be.equal('0', 'Bad reward rounds reward');
                expect(cur_round.startTime).to.be.equal(last_reward_time.toString(), 'Bad reward rounds start time');
            });

            it("Election on new round starts", async function () {
                await wait(5000);

                await user2.runTarget({
                    contract: stakingRoot,
                    method: 'startElectionOnNewRound',
                    params: {send_gas_to: user2.address},
                    value: convertCrystal(1.6, 'nano')
                });

                const election = await getElection(3);

                const round_num = await election.call({method: 'round_num'});
                expect(round_num.toString()).to.be.equal('3', "Bad election - round num");

                const { value: {
                    round_num: _round_num,
                    election_start_time: _election_start_time,
                    election_addr: _election_addr,
                } } = (await stakingRoot.getEvents('ElectionStarted')).pop();

                expect(_round_num.toString()).to.be.equal('3', "Bad election - round num");
                expect(_election_addr).to.be.equal(election.address, "Bad election - address");

            });

            it("Users request relay membership", async function() {
                const tx = await requestRelayMembership(user1);

                const { value: {
                    round_num: _round_num1,
                    tokens: _tokens1,
                    ton_pubkey: _ton_pubkey1,
                    eth_address: _eth_address1,
                    lock_until: _lock_until1
                } } = (await user1Data.getEvents('RelayMembershipRequested')).pop();

                const user1_token_balance = await user1Data.call({method: 'token_balance'});

                const user1_pk = new BigNumber(user1.keyPair.public, 16);
                const expected_ton_pubkey1 = `0x${user1_pk.toString(16).padStart(64, '0')}`;
                const user1_eth = new BigNumber(user1_eth_addr.toLowerCase(), 16);
                const block_now = tx.transaction.now + 30 * 24 * 60 * 60;

                const expected_eth_addr = `0x${user1_eth.toString(16).padStart(64, '0')}`
                expect(_round_num1.toString()).to.be.equal('3', 'Bad event - round num');
                expect(_tokens1.toString()).to.be.equal(user1_token_balance.toString(), "Bad event - tokens");
                expect(_ton_pubkey1.toString()).to.be.equal(expected_ton_pubkey1, "Bad event - ton pubkey");
                expect(_eth_address1.toString(16)).to.be.equal(expected_eth_addr, "Bad event - eth address");
                expect(Number(_lock_until1)).to.be.gte(Number(block_now), "Bad event - lock");
            });

            it("Election ends, not enough users participated, clone prev. round", async function() {
                await wait(3500);

                const reward_rounds = await stakingRoot.call({method: 'rewardRounds'});

                const tx = await endElection();
                // console.log(tx.transaction.out_msgs);

                const round = await getRelayRound(3);
                // const election = await getElection(2);

                // console.log('root', stakingRoot.address)
                // console.log('election', election.address);
                // console.log('round', round.address);

                const { value: {
                    round_num: _round_num,
                    relay_requests: _relay_requests,
                    min_relays_ok: _min_relays_ok
                } } = (await stakingRoot.getEvents('ElectionEnded')).pop();

                expect(_round_num.toString()).to.be.equal('3', "Bad election event - round num");
                expect(_relay_requests.toString()).to.be.equal('1', "Bad election event - relay requests");
                expect(_min_relays_ok).to.be.equal(false, "Bad election event - min relays");

                const { value: {
                    round_num: _round_num1,
                    round_start_time: _round_start_time,
                    round_addr: _round_addr,
                    relays_count: _relays_count,
                    duplicate: _duplicate
                } } = (await stakingRoot.getEvents('RelayRoundInitialized')).pop();

                expect(_round_num1.toString()).to.be.equal('3', "Bad relay init event - round num");
                expect(_round_addr.toString()).to.be.equal(round.address, "Bad relay init event - round addr");
                expect(_relays_count.toString()).to.be.equal('3', "Bad relay init event - relays count");
                expect(_duplicate).to.be.equal(true, "Bad relay init event - duplicate");

                const stored_round_num = await round.call({method: 'round_num'});
                const stored_relays_count = await round.call({method: 'relays_count'});
                const stored_total_tokens_staked = await round.call({method: 'total_tokens_staked'});
                const stored_reward_round_num = await round.call({method: 'reward_round_num'});
                const stored_relays_installed = await round.call({method: 'relays_installed'});
                const stored_duplicate = await round.call({method: 'duplicate'});

                const expected_staked_tokens = userDeposit * 6;

                expect(stored_round_num.toString()).to.be.equal('3', "Bad round created - round num");
                expect(stored_relays_count.toString()).to.be.equal('3', "Bad round created - relays count");
                expect(stored_total_tokens_staked.toString(16)).to.be.equal(expected_staked_tokens.toString(16), "Bad round created - total tokens staked");
                expect(stored_reward_round_num.toString()).to.be.equal('1', "Bad round created - reward round num");
                expect(stored_relays_installed).to.be.equal(true, "Bad round created - relays installed");
                expect(stored_duplicate).to.be.equal(true, "Bad round created - duplicate");

                const round_reward = await round.call({method: 'round_reward'});
                const reward_rounds_new = await stakingRoot.call({method: 'rewardRounds'});
                // console.log(reward_rounds, reward_rounds_new, round_reward.toString());
                const expected_reward = round_reward.plus(new BigNumber(reward_rounds[1].totalReward));
                expect(expected_reward.toString()).to.be.equal(reward_rounds_new[1].totalReward.toString(), "Bad reward after relay round init");

                const cur_relay_round = await stakingRoot.call({method: 'currentRelayRound'});
                expect(cur_relay_round.toString()).to.be.equal('3', "Bad round installed in root");

                // check all relays are installed
                const relays = await round.call({method: 'getRelayList', params: {count: 10}});
                const rel_addrs = relays.map((elem) => elem.staker_addr);
                expect(rel_addrs.includes(user1.address)).to.be.true;
                expect(rel_addrs.includes(user2.address)).to.be.true;
                expect(rel_addrs.includes(user3.address)).to.be.true;
            });

            it("Users get reward for prev relay round", async function() {
                await wait(1000);

                for (const i of [
                    [user1, userTokenWallet1, user1Data], [user2, userTokenWallet2, user2Data], [user3, userTokenWallet3, user3Data]
                ]) {
                    const [_user, _userTokenWallet, _userData] = i;

                    const relay_round = await getRelayRound(2);
                    const relay = await relay_round.call(
                        {method: 'getRelayByStakerAddress', params: {staker_addr: _user.address}}
                    );
                    const staked_tokens = new BigNumber(relay.staked_tokens.toString());
                    const total_tokens_staked = await relay_round.call({method: 'total_tokens_staked'});

                    // deposit 1 token to sync rewards
                    await depositTokens(_user, _userTokenWallet, 1);
                    const _user_rewards = await _userData.call({method: 'rewardRounds'});

                    await getRewardForRelayRound(_user, 2);
                    const _user_rewards_1 = await _userData.call({method: 'rewardRounds'});

                    const round_reward = rewardPerSec * RELAY_ROUND_TIME_1;
                    const user_share = staked_tokens.times(1e18).div(total_tokens_staked).dp(0, 1);
                    const user_reward = user_share.times(round_reward).div(1e18).dp(0, 1);

                    const expected = user_reward.plus(_user_rewards[0].reward_balance);
                    expect(expected.toString()).to.be.equal(_user_rewards_1[0].reward_balance.toString(), 'Bad reward');

                    const {
                        value: {
                            relay_round_num: _relay_round_num,
                            reward_round_num: _reward_round_num,
                            reward: _reward
                        }
                    } = (await _userData.getEvents('RelayRoundRewardClaimed')).pop();

                    const expected_reward = user_reward;
                    expect(_relay_round_num.toString()).to.be.equal('2', "Bad relay round reward event - relay round");
                    expect(_reward_round_num.toString()).to.be.equal('0', "Bad relay round reward event - reward round");
                    expect(_reward.toString()).to.be.equal(expected_reward.toString(), "Bad relay round reward event - reward");
                }
            });
        });

    });
})
