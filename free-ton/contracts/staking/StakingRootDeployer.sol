pragma ton-solidity >= 0.39.0;

import "./Staking.sol";

contract StakingRootDeployer {
    uint256 static nonce;

    constructor() public {
        tvm.accept();
    }

    function deploy(
        TvmCell stakingCode,
        address _admin,
        address _dao_root,
        address _rewarder,
        address _rescuer,
        address _bridge_event_config_eth_ton,
        address _bridge_event_config_ton_eth,
        address _tokenRoot,
        uint32 _deploy_nonce
    ) public returns(address) {
        tvm.accept();
        return new Staking {
            stateInit: tvm.buildStateInit({
                pubkey: tvm.pubkey(),
                code: stakingCode,
                contr: Staking,
                varInit: {
                    deploy_nonce: _deploy_nonce,
                    deployer: address(this)
                }
            }),
            value: address(this).balance - 1 ton,
            flag: 0
        }(_admin, _dao_root, _rewarder, _rescuer, _bridge_event_config_eth_ton, _bridge_event_config_ton_eth, _tokenRoot);
    }
}
