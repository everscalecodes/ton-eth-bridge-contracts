pragma ton-solidity ^0.39.0;

import "./interfaces/IRelayRound.sol";
import "./interfaces/IStakingPool.sol";
import "./interfaces/IUserData.sol";

import "./libraries/Gas.sol";
import "./libraries/PlatformTypes.sol";
import "./../utils/ErrorCodes.sol";

import "../../../node_modules/@broxus/contracts/contracts/libraries/MsgFlag.sol";
import "../../../node_modules/@broxus/contracts/contracts/platform/Platform.sol";


contract RelayRound is IRelayRound {
    event RelayRoundCodeUpgraded(uint32 code_version);

    bool public relays_installed;
    uint128 public relays_count;
    uint128 public start_time;
    uint128 public round_len;
    uint128 public total_tokens_staked;
    uint128 public reward_round_num;
    uint128 public round_reward;
    bool public duplicate;
    uint8 public expected_packs_num;
    address public election_addr;
    address public prev_round_addr;

    uint128 public round_num; // setup from initialData
    mapping (address => Relay) relays; // key - staker address
    mapping (address => bool) reward_claimed;

    uint8 public relay_packs_installed;

    // user when sending relays to new relay round
    address relay_transfer_start_address;

    uint32 public current_version;
    TvmCell public platform_code;

    address public root; // setup from initialData

    // Cant be deployed directly
    constructor() public { revert(); }

    function getRelayByStakerAddress(address staker_addr) external view responsible returns (Relay) {
        return {value: 0, flag: MsgFlag.REMAINING_GAS, bounce: false} relays[staker_addr];
    }

    function getRewardForRound(address staker_addr, address send_gas_to, uint32 code_version) external override onlyUserData(staker_addr) {
        require (now >= start_time + round_len, ErrorCodes.RELAY_ROUND_NOT_ENDED);
        require (reward_claimed[staker_addr] == false, ErrorCodes.RELAY_REWARD_CLAIMED);

        tvm.rawReserve(Gas.RELAY_ROUND_INITIAL_BALANCE, 2);

        if (code_version > current_version) {
            send_gas_to.transfer(0, false, MsgFlag.ALL_NOT_RESERVED);
            return;
        }

        reward_claimed[staker_addr] = true;
        uint128 staker_reward_share = math.muldiv(relays[staker_addr].staked_tokens, 1e18, total_tokens_staked);
        uint128 relay_reward = math.muldiv(staker_reward_share, round_reward, 1e18);

        IUserData(msg.sender).receiveRewardForRelayRound{ value: 0, flag: MsgFlag.ALL_NOT_RESERVED }(round_num, reward_round_num, relay_reward, send_gas_to);
    }

    function getRelayList(uint128 count) public view responsible returns (Relay[]) {
        optional(address, Relay) min_relay = relays.min();
        (address staker_addr, Relay _relay) = min_relay.get();
        (Relay[] _relays, address _) = _getRelayListFromMin(staker_addr, count);
        return _relays;
    }

    function _getRelayListFromMin(address min_addr, uint128 count) internal view returns (Relay[], address) {
        Relay[] _relays_list = new Relay[](count);
        address last_address = address.makeAddrNone();
        uint128 counter = 0;

        optional(Relay) min_relay = relays.fetch(min_addr);
        optional(address, Relay) cur_relay;
        cur_relay.set(min_addr, min_relay.get());

        while (cur_relay.hasValue() && counter < count) {
            (address staker_addr, Relay _relay) = cur_relay.get();
            _relays_list[counter] = _relay;
            counter++;
            cur_relay = relays.next(staker_addr);

            if (cur_relay.hasValue()) {
                (address staker_addr, Relay _relay) = cur_relay.get();
                last_address = staker_addr;
            } else {
                last_address = address.makeAddrNone();
            }
        }

        return (_relays_list, last_address);
    }

    function getDetails() external view override responsible returns (RelayRoundDetails) {
        Relay[] _relays_list = getRelayList(relays_count);

        return { value: 0, bounce: false, flag: MsgFlag.REMAINING_GAS }RelayRoundDetails(
            root, round_num, _relays_list, relays_installed, current_version
        );
    }

    function sendRelaysToRelayRound(address relay_round_addr, uint128 count, address send_gas_to) external override onlyRoot {
        tvm.rawReserve(Gas.ELECTION_INITIAL_BALANCE, 2);

        optional(Relay) min_relay = relays.fetch(relay_transfer_start_address);
        if (!min_relay.hasValue()) {
            IRelayRound(relay_round_addr).setEmptyRelays{ value: 0, flag: MsgFlag.ALL_NOT_RESERVED }(send_gas_to);
            return;
        }

        (Relay[] _relays, address _new_last_addr) = _getRelayListFromMin(relay_transfer_start_address, count);
        relay_transfer_start_address = _new_last_addr;

        IRelayRound(relay_round_addr).setRelays{ value: 0, flag: MsgFlag.ALL_NOT_RESERVED }(_relays, send_gas_to);
    }

    function relayKeys() public view responsible returns (uint256[]) {
        Relay[] _relays_list = getRelayList(relays_count);
        uint256[] _keys = new uint256[](_relays_list.length);
        for (uint256 i = 0; i < _keys.length; i++) {
            _keys[i] = _relays_list[i].ton_pubkey;
        }
        return { value: 0, bounce: false, flag: MsgFlag.REMAINING_GAS } _keys;
    }

    function setEmptyRelays(address send_gas_to) external override {
        require (msg.sender == election_addr || msg.sender == prev_round_addr || msg.sender == root, ErrorCodes.BAD_SENDER);
        require (!relays_installed, ErrorCodes.RELAY_ROUND_INITIALIZED);

        tvm.rawReserve(Gas.RELAY_ROUND_INITIAL_BALANCE, 2);

        relay_packs_installed += 1;
        _checkRelaysInstalled(send_gas_to);
    }

    function setRelays(Relay[] _relay_list, address send_gas_to) external override {
        require (msg.sender == election_addr || msg.sender == prev_round_addr || msg.sender == root, ErrorCodes.BAD_SENDER);
        require (!relays_installed, ErrorCodes.RELAY_ROUND_INITIALIZED);

        tvm.rawReserve(Gas.RELAY_ROUND_INITIAL_BALANCE, 2);

        for (uint i = 0; i < _relay_list.length; i++) {
            if (_relay_list[i].staked_tokens == 0) {
                break;
            }
            relays[_relay_list[i].staker_addr] = _relay_list[i];
            total_tokens_staked += _relay_list[i].staked_tokens;
            relays_count += 1;
        }

        relay_packs_installed += 1;
        _checkRelaysInstalled(send_gas_to);
    }

    function _checkRelaysInstalled(address send_gas_to) internal {
        if (relay_packs_installed == expected_packs_num) {
            relays_installed = true;

            optional(address, Relay) min_relay = relays.min();
            (address staker_addr, Relay _relay) = min_relay.get();
            relay_transfer_start_address = staker_addr;

            IStakingPool(root).onRelayRoundInitialized{ value: 0, flag: MsgFlag.ALL_NOT_RESERVED }(
                round_num, relays_count, round_reward, duplicate, send_gas_to
            );
            return;
        }
        send_gas_to.transfer({ value: 0, flag: MsgFlag.ALL_NOT_RESERVED });
    }

    function onCodeUpgrade(TvmCell upgrade_data) private {
        tvm.resetStorage();
        tvm.rawReserve(Gas.RELAY_ROUND_INITIAL_BALANCE, 2);

        TvmSlice s = upgrade_data.toSlice();
        (address root_, , address send_gas_to) = s.decode(address, uint8, address);
        root = root_;

        platform_code = s.loadRef();

        TvmSlice initialData = s.loadRefAsSlice();
        round_num = initialData.decode(uint128);

        TvmSlice params = s.loadRefAsSlice();
        current_version = params.decode(uint32);
        round_len = params.decode(uint128);
        reward_round_num = params.decode(uint128);
        uint128 reward_per_second = params.decode(uint128);
        duplicate = params.decode(bool);
        expected_packs_num = params.decode(uint8);
        election_addr = params.decode(address);
        prev_round_addr = params.decode(address);

        round_reward = reward_per_second * round_len;
        start_time = now;

        IStakingPool(root).onRelayRoundDeployed{ value: 0, flag: MsgFlag.ALL_NOT_RESERVED }(round_num, duplicate, send_gas_to);
    }

    function upgrade(TvmCell code, uint32 new_version, address send_gas_to) external onlyRoot {
        if (new_version == current_version) {
            tvm.rawReserve(Gas.RELAY_ROUND_INITIAL_BALANCE, 2);
            send_gas_to.transfer({ value: 0, flag: MsgFlag.ALL_NOT_RESERVED });
        } else {
            emit RelayRoundCodeUpgraded(new_version);

            TvmBuilder builder;

            builder.store(root);
            builder.store(round_num);
            builder.store(current_version);
            builder.store(new_version);
            builder.store(send_gas_to);

            builder.store(relays);
            builder.store(relays_installed);
            builder.store(relays_count);

            builder.store(platform_code);

            // set code after complete this method
            tvm.setcode(code);

            // run onCodeUpgrade from new code
            tvm.setCurrentCode(code);
            onCodeUpgrade(builder.toCell());
        }
    }

    function _buildInitData(uint8 type_id, TvmCell _initialData) internal inline view returns (TvmCell) {
        return tvm.buildStateInit({
            contr: Platform,
            varInit: {
                root: root,
                platformType: type_id,
                initialData: _initialData,
                platformCode: platform_code
            },
            pubkey: 0,
            code: platform_code
        });
    }

    function _buildUserDataParams(address user) private inline view returns (TvmCell) {
        TvmBuilder builder;
        builder.store(user);
        return builder.toCell();
    }

    function getUserDataAddress(address user) public view responsible returns (address) {
        return { value: 0, bounce: false, flag: MsgFlag.REMAINING_GAS } address(tvm.hash(_buildInitData(
            PlatformTypes.UserData,
            _buildUserDataParams(user)
        )));
    }

    modifier onlyUserData(address user) {
        address expectedAddr = getUserDataAddress(user);
        require (expectedAddr == msg.sender, ErrorCodes.NOT_USER_DATA);
        _;
    }

    modifier onlyRoot() {
        require(msg.sender == root, ErrorCodes.NOT_ROOT);
        _;
    }

}
